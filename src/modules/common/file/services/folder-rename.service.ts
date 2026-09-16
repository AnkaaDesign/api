import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { PrismaService } from '@modules/common/prisma/prisma.service';
import { promises as fs, existsSync, readdirSync, statSync } from 'fs';
import { join, dirname, relative, sep } from 'path';
import { FilesStorageService } from './files-storage.service';
import type { PrismaTransaction } from '../repositories/file.repository';

/**
 * Desfazer um movimento de bytes já feito em disco: o arquivo (ou a pasta) está
 * hoje em `at` e volta para `restoreTo`.
 */
interface DiskMove {
  at: string;
  restoreTo: string;
  isFolder: boolean;
}

export interface EntityFolderRenameResult {
  totalFoldersRenamed: number;
  totalFilesUpdated: number;
  /**
   * Desfaz em disco o que este rename moveu. Idempotente. O chamador DEVE
   * chamá-la se a transação em que passou `tx` abortar depois — ver
   * `renameEntityFolders`.
   */
  rollbackDisk: () => Promise<void>;
}

export interface EntityFolderMergeResult {
  totalFilesMoved: number;
  totalFilesUpdated: number;
  errors: string[];
  /** Mesmo contrato do rename: chame no catch da transação. Idempotente. */
  rollbackDisk: () => Promise<void>;
}

/**
 * Service to handle folder renaming when customer/supplier/user names change
 * This ensures consistency between folder names and database records
 */
@Injectable()
export class FolderRenameService {
  private readonly logger = new Logger(FolderRenameService.name);
  private readonly filesRoot = process.env.FILES_ROOT || './files';

  constructor(
    private readonly prisma: PrismaService,
    private readonly filesStorageService: FilesStorageService,
  ) {}

  /**
   * Nome da pasta da entidade.
   *
   * DELEGA de propósito para o mesmo sanitizador que o UPLOAD usa. Havia uma
   * cópia local aqui, e as duas já tinham divergido: `sanitizeFileName` troca
   * as barras por "_" (razão social com "S/A" é corriqueira) e esta não trocava.
   * Resultado: para todo cliente com barra no nome, o upload gravava em
   * `Clientes/Frix Logistica S_A/` e o rename ia procurar `Clientes/Frix
   * Logistica S/A/` — pasta que não existe —, não achava nada e saía calado,
   * deixando o banco apontando para o nome velho. Um sanitizador só, sem cópia,
   * é a única forma de isso não voltar a divergir.
   */
  private sanitizeFolderName(name: string): string {
    return this.filesStorageService.sanitizeFileName(name);
  }

  /** Prefixo de pasta com a barra final — ver o comentário em `updatePathsUnder`. */
  private folderPrefix(folderPath: string): string {
    return folderPath.endsWith(sep) ? folderPath : folderPath + sep;
  }

  /** Devolve os bytes já movidos aos lugares de origem. Idempotente. */
  private async undoDiskMoves(moves: DiskMove[]): Promise<void> {
    while (moves.length > 0) {
      const move = moves.pop() as DiskMove;
      try {
        if (move.isFolder) {
          await fs.rename(move.at, move.restoreTo);
        } else {
          await this.filesStorageService.moveWithinStorage(move.at, move.restoreTo);
        }
      } catch (error: any) {
        // Estado divergente e sem conserto automático: grita alto com os dois
        // caminhos, porque agora só uma pessoa resolve — e os bytes NÃO podem
        // ser recolhidos como órfãos enquanto isso.
        this.logger.error(
          `[FolderRename] INCONSISTÊNCIA: bytes em ${move.at} deveriam ter voltado para ` +
            `${move.restoreTo} e a devolução falhou (${error.message}). ` +
            `Corrija manualmente antes da próxima limpeza de órfãos.`,
        );
      }
    }
  }

  /**
   * Leva a pasta da entidade para o nome novo e deixa o banco apontando para
   * onde os bytes REALMENTE ficaram.
   *
   * A ordem importa: primeiro os bytes, depois o banco, e cada linha do banco só
   * é reescrita depois de confirmar que existe arquivo no destino. Nenhum caminho
   * de saída daqui pode terminar com o banco apontando para um lugar vazio — foi
   * exatamente isso que aconteceu quando o cliente "Mascarenhas" foi renomeado e
   * as fotos de check-in/check-out de "Mascarenhas & Chaves LTDA" sumiram de
   * todas as telas.
   *
   * Devolve também `diskMoves`: o que já foi mexido em disco, para o chamador
   * desfazer se a transação dele abortar depois (`fs.rename` não faz rollback).
   */
  private async renameFolderAndUpdatePaths(
    oldFolderPath: string,
    newFolderPath: string,
    tx: PrismaTransaction,
    diskMoves: DiskMove[],
  ): Promise<{ foldersRenamed: number; filesUpdated: number }> {
    let foldersRenamed = 0;

    if (!existsSync(oldFolderPath)) {
      // NÃO devolve aqui. A pasta antiga pode não existir e ainda assim haver
      // linhas no banco presas ao nome velho — é o caso de quem já foi renomeado
      // uma vez sem o banco acompanhar. A varredura abaixo cura essas linhas.
      this.logger.warn(
        `Pasta de origem não existe: ${oldFolderPath}. ` +
          `Seguindo só com a reconciliação do banco.`,
      );
    } else if (!existsSync(newFolderPath)) {
      // Caminho feliz: a pasta inteira vai junto, num rename só.
      const parentDir = dirname(newFolderPath);
      if (!existsSync(parentDir)) {
        await fs.mkdir(parentDir, { recursive: true });
      }
      try {
        await fs.rename(oldFolderPath, newFolderPath);
      } catch (error: any) {
        this.logger.error(`Failed to rename folder ${oldFolderPath} → ${newFolderPath}:`, error);
        throw new InternalServerErrorException(`Failed to rename folder: ${error.message}`);
      }
      diskMoves.push({ at: newFolderPath, restoreTo: oldFolderPath, isFolder: true });
      foldersRenamed++;
      this.logger.log(`Renamed folder: ${oldFolderPath} → ${newFolderPath}`);
      await fs.chmod(newFolderPath, 0o2775).catch((chmodError: any) => {
        this.logger.warn(`Could not set permissions for ${newFolderPath}: ${chmodError.message}`);
      });
    } else {
      // Destino ocupado — dois clientes que passam a dividir o mesmo nome de
      // pasta, ou um nome reciclado. A versão anterior "pulava o rename e
      // atualizava o banco assim mesmo": os bytes ficavam na pasta velha e o
      // banco passava a apontar para a nova. É a MESMA falha do prefixo, por
      // outra porta. Aqui a pasta vai junto de verdade, arquivo por arquivo.
      this.logger.log(
        `Pasta de destino já existe (${newFolderPath}); mesclando ${oldFolderPath} nela.`,
      );
      for (const sourcePath of this.getAllFilesRecursively(oldFolderPath)) {
        const targetPath = join(newFolderPath, relative(oldFolderPath, sourcePath));
        if (existsSync(targetPath)) {
          // Nunca sobrescrever: o byte fica onde está e a linha do banco
          // continua apontando para ele (a varredura abaixo respeita isso).
          this.logger.warn(`Destino já ocupado, mantendo na origem: ${targetPath}`);
          continue;
        }
        await this.filesStorageService.moveWithinStorage(sourcePath, targetPath);
        diskMoves.push({ at: targetPath, restoreTo: sourcePath, isFolder: false });
      }
      foldersRenamed++;
      await this.removeEmptyDirectories(oldFolderPath).catch((error: any) => {
        this.logger.warn(`Could not clean up ${oldFolderPath}: ${error.message}`);
      });
    }

    const filesUpdated = await this.updatePathsUnder(oldFolderPath, newFolderPath, tx);
    return { foldersRenamed, filesUpdated };
  }

  /**
   * Reescreve o prefixo das linhas de File presas à pasta antiga.
   *
   * A FRONTEIRA DE DIRETÓRIO NÃO É DETALHE. Sem a barra final, `startsWith` casa
   * QUALQUER pasta que comece com o nome antigo: renomear o cliente "Mascarenhas"
   * arrastava junto os arquivos de "Mascarenhas & Chaves LTDA", que viraram
   * "<nome novo> & Chaves LTDA" — pasta que não existe em disco. Os bytes ficavam
   * no lugar certo, o banco apontava para o nada, as imagens sumiam de toda tela
   * (só a miniatura, já gerada, sobrevivia) e em 7 dias o coletor de órfãos
   * apagava os arquivos.
   *
   * A segunda trava é o `existsSync` por linha: o banco só anda quando há byte no
   * destino. Linha sem byte em lugar nenhum já estava quebrada ANTES deste rename
   * — é registrada e deixada onde está, porque falhar aqui travaria para sempre o
   * rename de um cliente por causa de um arquivo perdido meses atrás.
   */
  private async updatePathsUnder(
    oldFolderPath: string,
    newFolderPath: string,
    tx: PrismaTransaction,
  ): Promise<number> {
    const oldPrefix = this.folderPrefix(oldFolderPath);
    const newPrefix = this.folderPrefix(newFolderPath);
    let filesUpdated = 0;
    const keptInPlace: string[] = [];
    const alreadyBroken: string[] = [];

    try {
      const filesToUpdate = await tx.file.findMany({
        where: { path: { startsWith: oldPrefix } },
        select: { id: true, path: true },
      });

      this.logger.log(`Found ${filesToUpdate.length} files to update in ${oldFolderPath}`);

      for (const file of filesToUpdate) {
        // Só o PREFIXO é reescrito — `replace` solto trocaria também uma
        // ocorrência do nome antigo no meio do caminho ou no nome do arquivo.
        const newPath = newPrefix + file.path.slice(oldPrefix.length);

        // A ORDEM DESTES DOIS IFS É A REGRA. Perguntar só "existe algo no
        // destino?" não serve: na mescla, o arquivo que NÃO foi movido por
        // colisão de nome tem um homônimo — de outro cliente — esperando lá.
        // Reescrever a linha aí faria o banco apontar para os bytes ERRADOS, o
        // que é pior que apontar para o vazio, porque a tela abre e mostra a
        // foto de outra pessoa. O byte ainda na origem manda: o arquivo não
        // saiu do lugar, então a linha também não sai.
        if (existsSync(file.path)) {
          keptInPlace.push(file.path);
          continue;
        }
        if (!existsSync(newPath)) {
          alreadyBroken.push(file.path);
          continue;
        }

        await tx.file.update({ where: { id: file.id }, data: { path: newPath } });
        filesUpdated++;
      }

      this.logger.log(`Updated ${filesUpdated} file paths in database`);
      if (keptInPlace.length > 0) {
        this.logger.warn(
          `[FolderRename] ${keptInPlace.length} arquivo(s) permaneceram na pasta antiga ` +
            `(destino já ocupado); o banco segue apontando para eles: ${keptInPlace.join(', ')}`,
        );
      }
      if (alreadyBroken.length > 0) {
        this.logger.error(
          `[FolderRename] ${alreadyBroken.length} arquivo(s) já estavam sem bytes ANTES deste ` +
            `rename e foram deixados como estavam: ${alreadyBroken.join(', ')}`,
        );
      }
    } catch (error: any) {
      this.logger.error(`Failed to update file paths in database:`, error);
      throw new InternalServerErrorException(`Failed to update file paths: ${error.message}`);
    }

    return filesUpdated;
  }


  /**
   * Leva a pasta de uma entidade para o nome novo, junto com o cliente/fornecedor/
   * colaborador que foi renomeado.
   *
   * `rollbackDisk` é a parte que o chamador NÃO pode esquecer: `fs.rename` não
   * participa da transação do Prisma. Se a transação que envolve este rename
   * abortar mais adiante — outra validação, um índice único, qualquer coisa —, o
   * banco volta sozinho para o nome antigo e os bytes ficam no nome novo. Aí a
   * pasta inteira fica sem dono no banco e o coletor de órfãos a recolhe em 7
   * dias. Chame `rollbackDisk()` no catch da transação; ela é idempotente.
   */
  private async renameEntityFolders(
    entityRoot: 'Clientes' | 'Fornecedores' | 'Colaboradores',
    label: string,
    oldName: string,
    newName: string,
    tx: PrismaTransaction,
  ): Promise<EntityFolderRenameResult> {
    this.logger.log(`Renaming ${label} folders: "${oldName}" → "${newName}"`);

    const oldSanitized = this.sanitizeFolderName(oldName);
    const newSanitized = this.sanitizeFolderName(newName);

    // Nomes diferentes que caem na MESMA pasta (a sanitização troca barras e
    // corta em 100 caracteres) não têm rename a fazer — e tentar mesclar a pasta
    // consigo mesma só faria estrago.
    if (oldSanitized === newSanitized) {
      this.logger.log('Folder names are identical after sanitization, skipping rename');
      return { totalFoldersRenamed: 0, totalFilesUpdated: 0, rollbackDisk: async () => {} };
    }

    // Entity-first layout: um rename de {entityRoot}/{nome}
    const oldPath = join(this.filesRoot, entityRoot, oldSanitized);
    const newPath = join(this.filesRoot, entityRoot, newSanitized);

    const diskMoves: DiskMove[] = [];
    let result: { foldersRenamed: number; filesUpdated: number };
    try {
      result = await this.renameFolderAndUpdatePaths(oldPath, newPath, tx, diskMoves);
    } catch (error) {
      await this.undoDiskMoves(diskMoves);
      throw error;
    }

    this.logger.log(
      `${label} folder rename complete: ${result.foldersRenamed} folders renamed, ${result.filesUpdated} files updated`,
    );

    return {
      totalFoldersRenamed: result.foldersRenamed,
      totalFilesUpdated: result.filesUpdated,
      rollbackDisk: async () => {
        if (diskMoves.length === 0) return;
        this.logger.warn(
          `[FolderRename] Transação abortada após o rename de ${label} ` +
            `"${oldName}" → "${newName}"; devolvendo os bytes a ${oldPath}.`,
        );
        await this.undoDiskMoves(diskMoves);
      },
    };
  }

  /**
   * Rename folders when customer fantasyName changes
   */
  async renameCustomerFolders(
    oldFantasyName: string,
    newFantasyName: string,
    tx: PrismaTransaction,
  ): Promise<EntityFolderRenameResult> {
    return this.renameEntityFolders('Clientes', 'Customer', oldFantasyName, newFantasyName, tx);
  }

  /**
   * Rename folders when supplier fantasyName changes
   */
  async renameSupplierFolders(
    oldFantasyName: string,
    newFantasyName: string,
    tx: PrismaTransaction,
  ): Promise<EntityFolderRenameResult> {
    return this.renameEntityFolders('Fornecedores', 'Supplier', oldFantasyName, newFantasyName, tx);
  }

  /**
   * Rename folders when user name changes
   */
  async renameUserFolders(
    oldName: string,
    newName: string,
    tx: PrismaTransaction,
  ): Promise<EntityFolderRenameResult> {
    return this.renameEntityFolders('Colaboradores', 'User', oldName, newName, tx);
  }

  /**
   * Merge multiple source entity folders into a target entity folder.
   * Moves all physical files and updates DB paths within the transaction.
   * Used during entity merge operations (e.g. merging duplicate customers).
   */
  async mergeEntityFolders(
    entityRoot: 'Clientes' | 'Fornecedores' | 'Colaboradores',
    sourceNames: string[],
    targetName: string,
    tx: PrismaTransaction,
  ): Promise<EntityFolderMergeResult> {
    let totalFilesMoved = 0;
    let totalFilesUpdated = 0;
    const errors: string[] = [];
    // Mesma exposição do rename: `fs.rename` não volta atrás com o Prisma. Se a
    // transação da fusão abortar depois daqui, os bytes ficam na pasta do
    // destino e o banco volta a apontar para a pasta de origem — órfãos, prazo
    // de 7 dias. Ver `renameEntityFolders`.
    const diskMoves: DiskMove[] = [];

    const targetSanitized = this.sanitizeFolderName(targetName);
    const targetFolder = join(this.filesRoot, entityRoot, targetSanitized);

    for (const sourceName of sourceNames) {
      const sourceSanitized = this.sanitizeFolderName(sourceName);

      if (sourceSanitized === targetSanitized) {
        this.logger.log(`Source "${sourceName}" same as target after sanitization, skipping`);
        continue;
      }

      const sourceFolder = join(this.filesRoot, entityRoot, sourceSanitized);

      if (!existsSync(sourceFolder)) {
        this.logger.log(`Source folder does not exist, skipping: ${sourceFolder}`);
        continue;
      }

      this.logger.log(`Merging entity folder: ${sourceFolder} → ${targetFolder}`);

      // Get all files recursively from source
      const files = this.getAllFilesRecursively(sourceFolder);
      this.logger.log(`Found ${files.length} files to merge from "${sourceName}"`);

      for (const filePath of files) {
        const relativePath = relative(sourceFolder, filePath);
        const targetPath = join(targetFolder, relativePath);

        // Skip if target already exists (don't overwrite)
        if (existsSync(targetPath)) {
          this.logger.warn(`Target already exists, skipping: ${targetPath}`);
          continue;
        }

        try {
          // Create target directory
          await fs.mkdir(dirname(targetPath), { recursive: true });

          // Move file
          try {
            await fs.rename(filePath, targetPath);
          } catch (err: any) {
            if (err.code === 'EXDEV') {
              await fs.copyFile(filePath, targetPath);
              await fs.unlink(filePath);
            } else {
              throw err;
            }
          }

          await fs.chmod(targetPath, 0o664).catch(() => {});
          diskMoves.push({ at: targetPath, restoreTo: filePath, isFolder: false });
          totalFilesMoved++;
        } catch (error: any) {
          const msg = `Failed to move ${filePath} → ${targetPath}: ${error.message}`;
          this.logger.error(msg);
          errors.push(msg);
          continue;
        }

        // Update DB path
        const dbFiles = await tx.file.findMany({
          where: { path: filePath },
          select: { id: true },
        });

        for (const dbFile of dbFiles) {
          await tx.file.update({
            where: { id: dbFile.id },
            data: { path: targetPath },
          });
          totalFilesUpdated++;
        }
      }

      // Clean up empty source directory
      try {
        await this.removeEmptyDirectories(sourceFolder);
      } catch (error: any) {
        this.logger.warn(`Could not clean up ${sourceFolder}: ${error.message}`);
      }
    }

    this.logger.log(
      `Entity folder merge complete: ${totalFilesMoved} files moved, ${totalFilesUpdated} DB paths updated, ${errors.length} errors`,
    );

    return {
      totalFilesMoved,
      totalFilesUpdated,
      errors,
      rollbackDisk: async () => {
        if (diskMoves.length === 0) return;
        this.logger.warn(
          `[FolderRename] Transação abortada após a fusão em ${targetFolder}; ` +
            `devolvendo ${diskMoves.length} arquivo(s) às pastas de origem.`,
        );
        await this.undoDiskMoves(diskMoves);
      },
    };
  }

  /**
   * Get all files recursively from a directory
   */
  private getAllFilesRecursively(dir: string): string[] {
    const files: string[] = [];
    if (!existsSync(dir)) return files;

    for (const item of readdirSync(dir)) {
      const fullPath = join(dir, item);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        files.push(...this.getAllFilesRecursively(fullPath));
      } else {
        files.push(fullPath);
      }
    }
    return files;
  }

  /**
   * Remove empty directories bottom-up
   */
  private async removeEmptyDirectories(dir: string): Promise<void> {
    if (!existsSync(dir)) return;

    const items = readdirSync(dir);
    for (const item of items) {
      const fullPath = join(dir, item);
      if (statSync(fullPath).isDirectory()) {
        await this.removeEmptyDirectories(fullPath);
      }
    }

    // Re-check after cleaning subdirs
    if (readdirSync(dir).length === 0) {
      await fs.rmdir(dir);
    }
  }

  /**
   * Validate that all file paths in database match their physical files
   * Useful for debugging and verification
   */
  async validateFilePaths(tx?: PrismaTransaction): Promise<{
    total: number;
    valid: number;
    invalid: Array<{ id: string; path: string; reason: string }>;
  }> {
    const transaction = tx || this.prisma;

    const files = await transaction.file.findMany({
      select: { id: true, path: true },
    });

    const invalid: Array<{ id: string; path: string; reason: string }> = [];
    let valid = 0;

    for (const file of files) {
      if (!existsSync(file.path)) {
        invalid.push({
          id: file.id,
          path: file.path,
          reason: 'File does not exist on filesystem',
        });
      } else {
        valid++;
      }
    }

    return {
      total: files.length,
      valid,
      invalid,
    };
  }
}
