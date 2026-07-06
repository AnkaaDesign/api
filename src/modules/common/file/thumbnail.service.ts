import { Injectable, Logger } from '@nestjs/common';
import { promises as fs } from 'fs';
import { join, dirname, extname, basename } from 'path';
const sharp = require('sharp');
const ffmpeg = require('fluent-ffmpeg');
import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync } from 'fs';
import { FilesStorageService } from './services/files-storage.service';
import { THUMBNAIL_CONFIG } from './config/thumbnail.config';
import { env } from '../../../common/config/env.validation';

const execAsync = promisify(exec);

// Check for Ghostscript binary location
const GS_BINARY = existsSync('/opt/homebrew/bin/gs') ? '/opt/homebrew/bin/gs' : 'gs';

export interface ThumbnailOptions {
  width?: number;
  height?: number;
  quality?: number;
  format?: 'png' | 'jpg' | 'webp';
  fit?: 'cover' | 'contain' | 'fill' | 'inside' | 'outside';
}

export interface ThumbnailResult {
  success: boolean;
  thumbnailPath?: string;
  thumbnailUrl?: string;
  error?: string;
}

export interface ThumbnailSize {
  small: { width: 150; height: 150 };
  medium: { width: 300; height: 300 };
  large: { width: 600; height: 600 };
  xlarge: { width: 1200; height: 1200 };
  xxlarge: { width: 2400; height: 2400 };
}

@Injectable()
export class ThumbnailService {
  private readonly logger = new Logger(ThumbnailService.name);

  private readonly thumbnailSizes: ThumbnailSize = {
    small: { width: 150, height: 150 },
    medium: { width: 300, height: 300 },
    large: { width: 600, height: 600 },
    xlarge: { width: 1200, height: 1200 },
    xxlarge: { width: 2400, height: 2400 },
  };

  private readonly defaultOptions: Required<ThumbnailOptions> = {
    width: 300,
    height: 300,
    quality: 100,
    format: 'webp',
    fit: 'contain',
  };

  private toolsAvailable = {
    ghostscript: false,
    imagemagick: false,
    inkscape: false,
    ffmpeg: false,
    pdftocairo: false,
  };

  constructor(private readonly filesStorageService: FilesStorageService) {
    this.checkAvailableTools();
  }

  /**
   * Check which tools are available on the system
   */
  private async checkAvailableTools(): Promise<void> {
    try {
      // Check Ghostscript
      await execAsync(`${GS_BINARY} --version`);
      this.toolsAvailable.ghostscript = true;
      this.logger.log(`Ghostscript disponível: ${GS_BINARY}`);
    } catch (e) {
      this.logger.warn('Ghostscript não está instalado. Instale com: brew install ghostscript');
    }

    try {
      // Check ImageMagick (try 'magick' for v7, 'convert' for v6)
      try {
        await execAsync('magick -version');
        this.toolsAvailable.imagemagick = true;
        this.logger.log('ImageMagick v7 disponível (magick)');
      } catch {
        // Try ImageMagick 6 (convert command)
        await execAsync('convert -version');
        this.toolsAvailable.imagemagick = true;
        this.logger.log('ImageMagick v6 disponível (convert)');
      }
    } catch (e) {
      this.logger.warn('ImageMagick não está instalado. Instale com: apt install imagemagick');
    }

    try {
      // Check Inkscape
      await execAsync('inkscape --version');
      this.toolsAvailable.inkscape = true;
      this.logger.log('Inkscape disponível');
    } catch (e) {
      this.logger.log(
        'Inkscape não está disponível (opcional para melhor conversão EPS->SVG). Instale com: brew install inkscape',
      );
    }

    try {
      // Check pdftocairo (poppler-utils). Preferred EPS/PDF rasterizer: Cairo's
      // anti-aliasing is markedly cleaner than Ghostscript's on vector line-art and
      // it renders straight into a bounded pixel box, so it is both faster and sharper.
      // When absent, the EPS pipeline transparently falls back to Ghostscript.
      await execAsync('pdftocairo -v');
      this.toolsAvailable.pdftocairo = true;
      this.logger.log('pdftocairo (poppler) disponível — rasterização EPS/PDF de alta qualidade');
    } catch (e) {
      this.logger.warn(
        'pdftocairo não está instalado (opcional, recomendado). Thumbnails de EPS usarão o Ghostscript. ' +
          'Instale com: apk add poppler-utils / apt install poppler-utils / pacman -S poppler',
      );
    }

    try {
      // Check FFmpeg
      const ffmpegPath = THUMBNAIL_CONFIG.tools.ffmpegPath || 'ffmpeg';
      await execAsync(`${ffmpegPath} -version`);
      this.toolsAvailable.ffmpeg = true;
      if (THUMBNAIL_CONFIG.tools.ffmpegPath) {
        ffmpeg.setFfmpegPath(THUMBNAIL_CONFIG.tools.ffmpegPath);
      }
      this.logger.log('FFmpeg disponível');
    } catch (e) {
      this.logger.warn(
        'FFmpeg não está instalado. Instale com: brew install ffmpeg (macOS) ou apt-get install ffmpeg (Ubuntu)',
      );
    }
  }

  /**
   * Generate thumbnail for a file based on its type
   */
  async generateThumbnail(
    filePath: string,
    mimetype: string,
    fileId: string,
    options: ThumbnailOptions = {},
  ): Promise<ThumbnailResult> {
    try {
      // Check if file exists
      await fs.access(filePath);

      const finalOptions = { ...this.defaultOptions, ...options };
      const thumbnailPath = await this.getThumbnailPath(filePath, fileId, finalOptions);

      // Check if thumbnail already exists (caching)
      try {
        await fs.access(thumbnailPath);
        const stats = await fs.stat(thumbnailPath);

        // If thumbnail exists and is not empty, return it
        if (stats.size > 0) {
          this.logger.log(`Thumbnail já existe, usando cache: ${thumbnailPath}`);
          return {
            success: true,
            thumbnailPath,
            thumbnailUrl: this.generateThumbnailUrl(thumbnailPath, fileId),
          };
        }
      } catch (e) {
        // Thumbnail doesn't exist, proceed to generate
      }

      if (this.isImageFile(mimetype)) {
        return await this.generateImageThumbnail(filePath, fileId, options);
      } else if (this.isVideoFile(mimetype)) {
        return await this.generateVideoThumbnail(filePath, fileId, options);
      } else if (this.isPdfFile(mimetype)) {
        return await this.generatePdfThumbnail(filePath, fileId, options);
      } else if (this.isEpsFile(mimetype)) {
        return await this.generateEpsThumbnail(filePath, fileId, options);
      } else if (this.isSvgFile(mimetype)) {
        return await this.generateSvgThumbnail(filePath, fileId, options);
      } else {
        return {
          success: false,
          error: `Tipo de arquivo não suportado para geração de thumbnail: ${mimetype}`,
        };
      }
    } catch (error: any) {
      this.logger.error(`Falha ao gerar thumbnail para ${filePath}:`, error);
      return {
        success: false,
        error: error.message || 'Erro desconhecido ao gerar thumbnail',
      };
    }
  }

  /**
   * Generate multiple size thumbnails
   */
  async generateMultipleThumbnails(
    filePath: string,
    mimetype: string,
    fileId: string,
  ): Promise<Record<string, ThumbnailResult>> {
    const results: Record<string, ThumbnailResult> = {};

    for (const [size, dimensions] of Object.entries(this.thumbnailSizes)) {
      results[size] = await this.generateThumbnail(filePath, mimetype, fileId, {
        width: dimensions.width,
        height: dimensions.height,
      });
    }

    return results;
  }

  /**
   * Generate thumbnail for image files
   */
  private async generateImageThumbnail(
    imagePath: string,
    fileId: string,
    options: ThumbnailOptions = {},
  ): Promise<ThumbnailResult> {
    try {
      const finalOptions = { ...this.defaultOptions, ...options };
      const thumbnailPath = await this.getThumbnailPath(imagePath, fileId, finalOptions);

      this.logger.log(`Gerando thumbnail de imagem: ${imagePath} -> ${thumbnailPath}`);

      // Use sharp to generate thumbnail
      await sharp(imagePath)
        .resize(finalOptions.width, finalOptions.height, {
          fit: finalOptions.fit as any,
          withoutEnlargement: true,
        })
        .toFormat(finalOptions.format as any, { quality: finalOptions.quality })
        .toFile(thumbnailPath);

      const thumbnailUrl = this.generateThumbnailUrl(thumbnailPath, fileId);

      this.logger.log(`Thumbnail de imagem gerado com sucesso: ${thumbnailUrl}`);

      return {
        success: true,
        thumbnailPath,
        thumbnailUrl,
      };
    } catch (error: any) {
      this.logger.error(`Falha ao gerar thumbnail de imagem para ${imagePath}:`, error);
      return {
        success: false,
        error: error.message || 'Erro ao processar imagem',
      };
    }
  }

  /**
   * Generate thumbnail for video files using FFmpeg frame extraction
   */
  private async generateVideoThumbnail(
    videoPath: string,
    fileId: string,
    options: ThumbnailOptions = {},
  ): Promise<ThumbnailResult> {
    try {
      if (!this.toolsAvailable.ffmpeg) {
        return {
          success: false,
          error:
            'FFmpeg não está instalado. Instale com: brew install ffmpeg (macOS) ou apt-get install ffmpeg (Ubuntu)',
        };
      }

      const finalOptions = { ...this.defaultOptions, ...options };
      const thumbnailPath = await this.getThumbnailPath(videoPath, fileId, finalOptions);

      this.logger.log(`Gerando thumbnail de vídeo: ${videoPath} -> ${thumbnailPath}`);

      // Ensure the thumbnail directory exists
      await fs.mkdir(dirname(thumbnailPath), { recursive: true });

      // Temp path for the raw extracted frame (PNG for lossless intermediate)
      const tempFramePath = thumbnailPath.replace(/\.\w+$/, '_temp_frame.png');

      // Step 1: Get video duration to calculate the frame extraction timestamp
      const duration = await this.getVideoDuration(videoPath);
      const seekTime = this.calculateSeekTime(duration);

      this.logger.log(`Vídeo duration: ${duration}s, extracting frame at ${seekTime}s`);

      // Step 2: Extract a single frame from the video using FFmpeg
      await this.extractVideoFrame(videoPath, tempFramePath, seekTime, finalOptions);

      // Verify temp frame was created
      try {
        const stats = await fs.stat(tempFramePath);
        if (stats.size === 0) {
          throw new Error('Frame extraído está vazio');
        }
      } catch (e: any) {
        throw new Error(`Falha ao extrair frame do vídeo: ${e.message}`);
      }

      // Step 3: Convert extracted frame to optimized thumbnail with Sharp
      await sharp(tempFramePath)
        .resize(finalOptions.width, finalOptions.height, {
          fit: finalOptions.fit as any,
          withoutEnlargement: true,
          background: { r: 0, g: 0, b: 0 },
        })
        .toFormat(finalOptions.format as any, {
          quality: finalOptions.quality,
          effort: 6,
        })
        .toFile(thumbnailPath);

      // Clean up temp frame
      try {
        await fs.unlink(tempFramePath);
      } catch (e) {
        this.logger.warn(`Não foi possível remover frame temporário: ${tempFramePath}`);
      }

      const thumbnailUrl = this.generateThumbnailUrl(thumbnailPath, fileId);

      this.logger.log(`Thumbnail de vídeo gerado com sucesso: ${thumbnailUrl}`);

      return {
        success: true,
        thumbnailPath,
        thumbnailUrl,
      };
    } catch (error: any) {
      this.logger.error(`Falha ao gerar thumbnail de vídeo para ${videoPath}:`, error);
      return {
        success: false,
        error: error.message || 'Erro ao processar vídeo',
      };
    }
  }

  /**
   * Get video duration in seconds using FFprobe
   */
  private getVideoDuration(videoPath: string): Promise<number> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(videoPath, (err: any, metadata: any) => {
        if (err) {
          this.logger.warn(
            `FFprobe falhou para ${videoPath}: ${err.message}, usando duração padrão`,
          );
          // Return a default duration so we can still attempt frame extraction
          resolve(10);
          return;
        }

        const duration = metadata?.format?.duration;
        if (duration && !isNaN(duration)) {
          resolve(parseFloat(duration));
        } else {
          this.logger.warn(`Duração do vídeo não disponível para ${videoPath}, usando padrão`);
          resolve(10);
        }
      });
    });
  }

  /**
   * Calculate the best timestamp to extract a frame from a video.
   * Uses 10% of the duration (minimum 1s, maximum 10s) to avoid black intro frames.
   */
  private calculateSeekTime(duration: number): number {
    if (duration <= 0) {
      return 0;
    }

    // 10% into the video, clamped between 1s and 10s
    const seekTime = duration * 0.1;
    return Math.min(Math.max(seekTime, Math.min(1, duration)), Math.min(10, duration));
  }

  /**
   * Extract a single frame from a video file using FFmpeg
   */
  private extractVideoFrame(
    videoPath: string,
    outputPath: string,
    seekTime: number,
    options: Required<ThumbnailOptions>,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      // Use a larger intermediate size for better quality after Sharp resize
      const intermediateSize = `${options.width * 2}x${options.height * 2}`;

      const timeout = setTimeout(() => {
        reject(new Error('FFmpeg frame extraction timed out after 30 seconds'));
      }, 30000);

      ffmpeg(videoPath)
        .seekInput(seekTime)
        .frames(1)
        .size(intermediateSize)
        .outputOptions(['-q:v', '2']) // High quality output
        .output(outputPath)
        .on('end', () => {
          clearTimeout(timeout);
          resolve();
        })
        .on('error', (err: any) => {
          clearTimeout(timeout);
          this.logger.error(`FFmpeg frame extraction error: ${err.message}`);
          reject(new Error(`FFmpeg frame extraction failed: ${err.message}`));
        })
        .run();
    });
  }

  /**
   * Generate thumbnail for PDF files
   */
  private async generatePdfThumbnail(
    pdfPath: string,
    fileId: string,
    options: ThumbnailOptions = {},
  ): Promise<ThumbnailResult> {
    try {
      const finalOptions = { ...this.defaultOptions, ...options };
      const thumbnailPath = await this.getThumbnailPath(pdfPath, fileId, finalOptions);

      this.logger.log(`Gerando thumbnail de PDF: ${pdfPath} -> ${thumbnailPath}`);

      // Use higher quality settings for better output
      const tempPngPath = thumbnailPath.replace('.webp', '_temp.png');

      // Ensure directory exists
      await fs.mkdir(dirname(tempPngPath), { recursive: true });

      // Use moderate density for good quality with reasonable memory usage
      // Create a 2x larger temp image for better quality after downscaling
      // Note: 300 DPI with 3x size can use 500MB+ RAM per conversion
      const tempSize = finalOptions.width * 2;
      const density = 150; // Good quality for thumbnails, lower memory usage
      const quality = 90;

      try {
        // Try ImageMagick first with improved settings (try 'magick' for v7, 'convert' for v6)
        // Add -limit memory 256MB -limit map 512MB to prevent excessive memory usage
        let magickCommand = `magick -limit memory 256MB -limit map 512MB -density ${density} "${pdfPath}[0]" -background white -alpha remove -resize ${tempSize}x${tempSize} -quality ${quality} "${tempPngPath}"`;

        this.logger.log(`Executando comando ImageMagick (v7): ${magickCommand}`);
        try {
          await execAsync(magickCommand, { timeout: 60000 });
        } catch {
          // Try ImageMagick 6 (convert command)
          magickCommand = `convert -limit memory 256MB -limit map 512MB -density ${density} "${pdfPath}[0]" -background white -alpha remove -resize ${tempSize}x${tempSize} -quality ${quality} "${tempPngPath}"`;
          this.logger.log(`Executando comando ImageMagick (v6): ${magickCommand}`);
          await execAsync(magickCommand, { timeout: 60000 });
        }
      } catch (error) {
        this.logger.warn('ImageMagick falhou, tentando Ghostscript...');

        // Fallback to Ghostscript with size constraints
        // Use -dPDFFitPage with -g to constrain output size and avoid enormous PNGs
        const gsCommand = `${GS_BINARY} -dNOPAUSE -dBATCH -dSAFER -sDEVICE=pngalpha -g${tempSize}x${tempSize} -dPDFFitPage -r${density} -dTextAlphaBits=4 -dGraphicsAlphaBits=4 -dFirstPage=1 -dLastPage=1 -sOutputFile="${tempPngPath}" "${pdfPath}"`;

        this.logger.log(`Executando comando Ghostscript: ${gsCommand}`);
        await execAsync(gsCommand, { timeout: 30000 });
      }

      // Verify temp file was created
      try {
        await fs.access(tempPngPath);
      } catch (e) {
        throw new Error(`Arquivo temporário não foi criado: ${tempPngPath}`);
      }

      // Optimize with sharp - trim black borders and add white background
      await sharp(tempPngPath)
        .trim({
          background: '#000000', // Trim black letterbox borders
          threshold: 10, // Allow slight variations in black
        })
        .flatten({ background: { r: 255, g: 255, b: 255 } }) // Add white background
        .resize(finalOptions.width, finalOptions.height, {
          fit: finalOptions.fit as any,
          withoutEnlargement: true,
          kernel: sharp.kernel.lanczos3,
          background: { r: 255, g: 255, b: 255 }, // White background for padding
        })
        .toFormat(finalOptions.format as any, {
          quality: 100,
          effort: 6,
        })
        .toFile(thumbnailPath);

      // Clean up temp file
      try {
        await fs.unlink(tempPngPath);
      } catch (e) {
        this.logger.warn(`Não foi possível remover arquivo temporário: ${tempPngPath}`);
      }

      const thumbnailUrl = this.generateThumbnailUrl(thumbnailPath, fileId);

      this.logger.log(`Thumbnail de PDF gerado com sucesso: ${thumbnailUrl}`);

      return {
        success: true,
        thumbnailPath,
        thumbnailUrl,
      };
    } catch (error: any) {
      this.logger.error(`Falha ao gerar thumbnail de PDF para ${pdfPath}:`, error);
      return {
        success: false,
        error: error.message || 'Erro ao processar PDF',
      };
    }
  }

  /**
   * Generate a thumbnail for an EPS file.
   *
   * Pipeline (fast + high quality):
   *   1. Ghostscript: EPS -> vector PDF, cropped to the true art bounding box
   *      (`-dEPSCrop`). Handles CorelDRAW / Illustrator exports whose art lies outside
   *      the declared page box.
   *   2. pdftocairo: PDF -> PNG, rendered straight into a bounded pixel box
   *      (`-scale-to`). Cairo's anti-aliasing is markedly cleaner than Ghostscript's on
   *      vector line-art, and bounding the raster keeps even a 95"x122" canvas fast
   *      (~150ms) instead of exploding into a billion-pixel intermediate. Falls back to
   *      a bounded Ghostscript raster when poppler is unavailable — no regression.
   *   3. Sharp: flatten onto white, trim margins, fit to the requested box (Lanczos)
   *      and a light sharpen. Deliberately NO global contrast/darkening: Cairo already
   *      renders strokes dark and crisp, and any darkening distorts colour fills
   *      (it crushes dark backgrounds toward black).
   */
  private async generateEpsThumbnail(
    epsPath: string,
    fileId: string,
    options: ThumbnailOptions = {},
  ): Promise<ThumbnailResult> {
    const tempPdfPath = epsPath.replace(extname(epsPath), '_temp.pdf');
    // pdftocairo appends ".png" to the output prefix, so keep the base name separate.
    const tempPngBase = epsPath.replace(extname(epsPath), '_temp');
    const tempPngPath = `${tempPngBase}.png`;

    try {
      const finalOptions = { ...this.defaultOptions, ...options };
      const thumbnailPath = await this.getThumbnailPath(epsPath, fileId, finalOptions);
      const target = Math.max(finalOptions.width, finalOptions.height);

      this.logger.log(`Gerando thumbnail de EPS: ${epsPath} -> ${thumbnailPath}`);
      await fs.mkdir(dirname(tempPngPath), { recursive: true });

      // Produce a rasterized PNG (tempPngPath) via the best available pipeline.
      let rasterized = false;

      // Step 1+2: EPS -> cropped PDF -> PNG (pdftocairo preferred, Ghostscript fallback).
      try {
        await this.epsToCroppedPdf(epsPath, tempPdfPath);
        rasterized = await this.rasterizeCroppedPdf(tempPdfPath, tempPngBase, tempPngPath, target);
      } catch (pdfErr: any) {
        this.logger.warn(`EPS->PDF->PNG stage failed, will try ImageMagick: ${pdfErr.message}`);
      }

      // Last resort: let ImageMagick rasterize the EPS directly.
      if (!rasterized) {
        rasterized = await this.imagemagickEpsToPng(epsPath, tempPngPath, target);
      }

      if (!rasterized) {
        throw new Error('Nenhum conversor disponível conseguiu rasterizar o EPS (gs/pdftocairo/magick)');
      }

      // Step 3: finish with Sharp (white-flatten, trim, fit, light sharpen).
      await this.finishEpsThumbnail(tempPngPath, thumbnailPath, finalOptions);

      await this.safeUnlink(tempPngPath);
      await this.safeUnlink(tempPdfPath);

      const thumbnailUrl = this.generateThumbnailUrl(thumbnailPath, fileId);
      this.logger.log(`Thumbnail de EPS gerado com sucesso: ${thumbnailUrl}`);
      return { success: true, thumbnailPath, thumbnailUrl };
    } catch (error: any) {
      this.logger.error(`Falha ao gerar thumbnail de EPS para ${epsPath}:`, error);

      await this.safeUnlink(tempPngPath);
      await this.safeUnlink(tempPdfPath);

      if (
        error.message?.includes('convert') ||
        error.message?.includes('magick') ||
        error.message?.includes('gs')
      ) {
        return {
          success: false,
          error:
            'ImageMagick ou Ghostscript não está instalado. Instale ambos para melhor processamento de arquivos EPS.',
        };
      }

      return {
        success: false,
        error: error.message || 'Erro ao processar EPS',
      };
    }
  }

  /**
   * Convert an EPS to a vector PDF cropped to its true content bounding box.
   * `-dEPSCrop` normalizes the page to the art, which is crucial for CorelDRAW /
   * Illustrator exports whose content lives outside the declared page boundary.
   */
  private async epsToCroppedPdf(epsPath: string, pdfPath: string): Promise<void> {
    const cmd = [
      GS_BINARY,
      '-dNOPAUSE',
      '-dBATCH',
      '-dSAFER',
      '-sDEVICE=pdfwrite',
      '-dEPSCrop',
      '-dAutoRotatePages=/None',
      `-sOutputFile="${pdfPath}"`,
      `"${epsPath}"`,
    ].join(' ');
    this.logger.log(`EPS->PDF (crop): ${cmd}`);
    await execAsync(cmd, { timeout: 30000, killSignal: 'SIGTERM' });
  }

  /**
   * Rasterize a (cropped) PDF to a bounded PNG. Prefers pdftocairo for its superior
   * anti-aliasing; falls back to a bounded Ghostscript raster. Returns true on success.
   *
   * The raster is bounded to `target * supersample` on the long side (capped) so the
   * downstream Lanczos downscale gets clean super-sampled input while huge source
   * canvases never explode into gigapixel intermediates. 3x for normal thumbnails, 2x
   * for large (>=1200px) requests where the target itself already carries the detail.
   */
  private async rasterizeCroppedPdf(
    pdfPath: string,
    pngBase: string,
    pngPath: string,
    target: number,
  ): Promise<boolean> {
    const supersample = target > 600 ? 2 : 3;
    const scaleTo = Math.min(target * supersample, 3600);

    if (this.toolsAvailable.pdftocairo) {
      try {
        const cmd = `pdftocairo -png -scale-to ${scaleTo} -singlefile "${pdfPath}" "${pngBase}"`;
        this.logger.log(`PDF->PNG (pdftocairo, scale-to ${scaleTo}): ${cmd}`);
        await execAsync(cmd, { timeout: 30000, killSignal: 'SIGTERM' });
        if (await this.isNonEmptyFile(pngPath)) return true;
        this.logger.warn('pdftocairo produced an empty PNG, falling back to Ghostscript');
      } catch (e: any) {
        this.logger.warn(`pdftocairo failed, falling back to Ghostscript: ${e.message}`);
      }
    }

    // Ghostscript fallback: render the page into a fixed pixel box (aspect preserved)
    // so the output is bounded regardless of the source canvas size.
    const box = Math.min(scaleTo, 4096);
    try {
      const cmd = [
        GS_BINARY,
        '-dNOPAUSE',
        '-dBATCH',
        '-dSAFER',
        '-sDEVICE=pngalpha',
        '-r72',
        `-g${box}x${box}`,
        '-dPDFFitPage',
        '-dTextAlphaBits=4',
        '-dGraphicsAlphaBits=4',
        '-dQuiet',
        '-dFirstPage=1',
        '-dLastPage=1',
        `-sOutputFile="${pngPath}"`,
        `"${pdfPath}"`,
      ].join(' ');
      this.logger.log(`PDF->PNG (ghostscript, ${box}px box): ${cmd}`);
      await execAsync(cmd, { timeout: 30000, killSignal: 'SIGTERM' });
      return await this.isNonEmptyFile(pngPath);
    } catch (e: any) {
      this.logger.warn(`Ghostscript PDF->PNG failed: ${e.message}`);
      return false;
    }
  }

  /**
   * Last-resort rasterization: ImageMagick straight from the EPS. Slower and lower
   * quality than the cairo/gs path, but a useful safety net for odd EPS variants.
   */
  private async imagemagickEpsToPng(
    epsPath: string,
    pngPath: string,
    target: number,
  ): Promise<boolean> {
    if (!this.toolsAvailable.imagemagick) return false;
    const box = Math.min(target * 3, 3600);
    try {
      const cmd = [
        'magick',
        '-density',
        '200',
        `"${epsPath}[0]"`,
        '-background',
        'white',
        '-alpha',
        'remove',
        '-alpha',
        'off',
        '-colorspace',
        'sRGB',
        '-trim',
        '+repage',
        '-resize',
        `${box}x${box}>`,
        '-quality',
        '95',
        `"${pngPath}"`,
      ].join(' ');
      this.logger.log(`EPS->PNG (imagemagick fallback): ${cmd}`);
      await execAsync(cmd, { timeout: 30000, killSignal: 'SIGTERM' });
      return await this.isNonEmptyFile(pngPath);
    } catch (e: any) {
      this.logger.warn(`ImageMagick EPS->PNG failed: ${e.message}`);
      return false;
    }
  }

  /**
   * Finish an EPS thumbnail from the rasterized PNG: flatten onto white, trim margins,
   * fit to the requested box with Lanczos, and lightly sharpen. On any Sharp error
   * (e.g. trim on a perfectly uniform image) it retries once without the trim so a
   * thumbnail is always produced.
   */
  private async finishEpsThumbnail(
    pngPath: string,
    thumbnailPath: string,
    finalOptions: Required<ThumbnailOptions>,
  ): Promise<void> {
    const resizeOpts = {
      fit: finalOptions.fit as any,
      withoutEnlargement: true,
      kernel: sharp.kernel.lanczos3,
      background: { r: 255, g: 255, b: 255 },
    };
    try {
      await sharp(pngPath)
        .flatten({ background: { r: 255, g: 255, b: 255 } })
        .trim({ background: '#ffffff', threshold: 12 })
        .resize(finalOptions.width, finalOptions.height, resizeOpts)
        .sharpen({ sigma: 1 })
        .webp({ quality: 90, effort: 4 })
        .toFile(thumbnailPath);
    } catch (e: any) {
      this.logger.warn(`Sharp finish failed (${e.message}), retrying without trim`);
      await sharp(pngPath)
        .flatten({ background: { r: 255, g: 255, b: 255 } })
        .resize(finalOptions.width, finalOptions.height, resizeOpts)
        .sharpen({ sigma: 1 })
        .webp({ quality: 90, effort: 4 })
        .toFile(thumbnailPath);
    }
  }

  /** True when the path exists and is a non-empty file. */
  private async isNonEmptyFile(path: string): Promise<boolean> {
    try {
      const stats = await fs.stat(path);
      return stats.size > 0;
    } catch {
      return false;
    }
  }

  /** Delete a file, ignoring any error (missing file, permissions, etc.). */
  private async safeUnlink(path: string): Promise<void> {
    try {
      await fs.unlink(path);
    } catch {
      // ignore
    }
  }

  /**
   * Generate thumbnail for SVG files
   */
  private async generateSvgThumbnail(
    svgPath: string,
    fileId: string,
    options: ThumbnailOptions = {},
  ): Promise<ThumbnailResult> {
    try {
      const finalOptions = { ...this.defaultOptions, ...options };
      const thumbnailPath = await this.getThumbnailPath(svgPath, fileId, finalOptions);

      this.logger.log(`Gerando thumbnail de SVG: ${svgPath} -> ${thumbnailPath}`);

      try {
        // Try Sharp first (best quality for SVG)
        await sharp(svgPath)
          .resize(finalOptions.width, finalOptions.height, {
            fit: finalOptions.fit as any,
            withoutEnlargement: false,
            background: { r: 255, g: 255, b: 255, alpha: 1 },
          })
          .toFormat(finalOptions.format as any, {
            quality: finalOptions.quality,
            effort: 6,
          })
          .toFile(thumbnailPath);

        this.logger.log('SVG thumbnail gerado com Sharp');
      } catch (sharpError: any) {
        this.logger.warn(`Sharp SVG falhou: ${sharpError.message}, tentando ImageMagick...`);

        if (!this.toolsAvailable.imagemagick) {
          throw new Error('ImageMagick não está disponível para conversão SVG');
        }

        // Fallback to ImageMagick
        const magickCommand = [
          'magick',
          '-density',
          '300',
          '-background',
          'white',
          `"${svgPath}"`,
          '-flatten',
          '-resize',
          `${finalOptions.width}x${finalOptions.height}`,
          '-extent',
          `${finalOptions.width}x${finalOptions.height}`,
          '-gravity',
          'center',
          '-quality',
          '95',
          `"${thumbnailPath}"`,
        ].join(' ');

        this.logger.log(`Convertendo SVG com ImageMagick: ${magickCommand}`);
        await execAsync(magickCommand, { timeout: 30000 });
      }

      const thumbnailUrl = this.generateThumbnailUrl(thumbnailPath, fileId);

      this.logger.log(`Thumbnail de SVG gerado com sucesso: ${thumbnailUrl}`);

      return {
        success: true,
        thumbnailPath,
        thumbnailUrl,
      };
    } catch (error: any) {
      this.logger.error(`Falha ao gerar thumbnail de SVG para ${svgPath}:`, error);
      return {
        success: false,
        error: error.message || 'Erro ao processar SVG',
      };
    }
  }

  /**
   * Get thumbnail path based on original file and options
   */
  private async getThumbnailPath(
    originalPath: string,
    fileId: string,
    options: Required<ThumbnailOptions>,
  ): Promise<string> {
    // Generate thumbnail size string (e.g., "150x150", "300x300", "600x600")
    const thumbnailSize = `${options.width}x${options.height}`;

    // Generate thumbnail filename (without timestamp for consistent caching)
    const thumbnailFilename = `${fileId}_${thumbnailSize}.${options.format}`;

    // Use FilesStorageService to get the folder path for thumbnails
    const thumbnailFolder = this.filesStorageService.getFolderPath(
      'thumbnails',
      'image/webp', // Default MIME type for thumbnails
      undefined, // entityId
      undefined, // entityType
      undefined, // projectId
      undefined, // projectName
      undefined, // customerName
      undefined, // supplierName
      undefined, // userName
      undefined, // cutType
      thumbnailSize, // thumbnailSize parameter
    );

    // Ensure the directory exists
    await this.filesStorageService.ensureDirectory(thumbnailFolder);

    // Construct the full path manually (without timestamp)
    const thumbnailPath = join(thumbnailFolder, thumbnailFilename);

    return thumbnailPath;
  }

  /**
   * Generate public URL for thumbnail
   * Always use API endpoint for thumbnails to ensure compatibility in both dev and production
   */
  private generateThumbnailUrl(thumbnailPath: string, fileId?: string): string {
    if (!fileId) {
      // Fallback to storage URL if fileId is not provided (shouldn't happen)
      return this.filesStorageService.getFileUrl(thumbnailPath);
    }

    // Generate API endpoint URL for thumbnail
    // This works in both development and production
    const baseUrl = env.API_URL || `http://localhost:${env.PORT}`;
    return `${baseUrl}/files/thumbnail/${fileId}`;
  }

  /**
   * Delete thumbnail files
   */
  async deleteThumbnails(fileId: string): Promise<void> {
    try {
      // Delete thumbnails from all size directories
      for (const [size, dimensions] of Object.entries(this.thumbnailSizes)) {
        const thumbnailSize = `${dimensions.width}x${dimensions.height}`;

        // Find and delete thumbnails with different formats
        const formats = ['png', 'jpg', 'webp'];
        for (const format of formats) {
          const thumbnailFilename = `${fileId}_${thumbnailSize}.${format}`;

          // Get folder path for thumbnails
          const thumbnailFolder = this.filesStorageService.getFolderPath(
            'thumbnails',
            'image/webp',
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            thumbnailSize,
          );

          // Construct the full path
          const thumbnailPath = join(thumbnailFolder, thumbnailFilename);

          // Delete the file from storage
          await this.filesStorageService.deleteFromStorage(thumbnailPath);
          this.logger.log(`Thumbnail removido: ${thumbnailPath}`);
        }
      }
    } catch (error: any) {
      this.logger.warn(`Falha ao remover thumbnails para arquivo ${fileId}:`, error);
    }
  }

  /**
   * Get appropriate thumbnail size based on request
   */
  getThumbnailSize(size?: string): { width: number; height: number } {
    if (size && size in this.thumbnailSizes) {
      return this.thumbnailSizes[size as keyof ThumbnailSize];
    }
    return this.thumbnailSizes.medium;
  }

  /**
   * Check if file is a video
   */
  private isVideoFile(mimetype: string): boolean {
    return (
      mimetype.startsWith('video/') ||
      THUMBNAIL_CONFIG.supportedTypes.videos.includes(mimetype.toLowerCase())
    );
  }

  /**
   * Check if file is an image
   */
  private isImageFile(mimetype: string): boolean {
    return mimetype.startsWith('image/') && !this.isEpsFile(mimetype) && !this.isSvgFile(mimetype);
  }

  /**
   * Check if file is a PDF
   */
  private isPdfFile(mimetype: string): boolean {
    return mimetype === 'application/pdf';
  }

  /**
   * Check if file is an EPS
   */
  private isEpsFile(mimetype: string): boolean {
    return [
      'application/postscript',
      'application/x-eps',
      'application/eps',
      'image/eps',
      'image/x-eps',
    ].includes(mimetype);
  }

  /**
   * Check if file is an SVG
   */
  private isSvgFile(mimetype: string): boolean {
    return mimetype === 'image/svg+xml';
  }
}
