import { Injectable, Logger } from '@nestjs/common';
import { promises as fs } from 'fs';
import { join, dirname, extname, basename } from 'path';
const sharp = require('sharp');
import { exec } from 'child_process';
import { promisify } from 'util';
import { existsSync } from 'fs';
import { WebDAVService } from './services/webdav.service';
import { THUMBNAIL_CONFIG } from './config/thumbnail.config';

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
  };

  constructor(private readonly webdavService: WebDAVService) {
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
      // Check ImageMagick
      await execAsync('magick -version');
      this.toolsAvailable.imagemagick = true;
      this.logger.log('ImageMagick disponível');
    } catch (e) {
      this.logger.warn('ImageMagick não está instalado. Instale com: brew install imagemagick');
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

      // Use high density and size constraints for maximum quality
      // Create a 3x larger temp image for better quality after downscaling
      const tempSize = finalOptions.width * 3;
      const density = 300; // Maximum density for best quality
      const quality = 100;

      try {
        // Try ImageMagick first with improved settings
        const magickCommand = `magick -density ${density} "${pdfPath}[0]" -background white -alpha remove -resize ${tempSize}x${tempSize} -quality ${quality} "${tempPngPath}"`;

        this.logger.log(`Executando comando ImageMagick: ${magickCommand}`);
        await execAsync(magickCommand, { timeout: 30000 });
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
   * Generate thumbnail for EPS files using EPS->SVG->PNG pipeline
   */
  private async generateEpsThumbnail(
    epsPath: string,
    fileId: string,
    options: ThumbnailOptions = {},
  ): Promise<ThumbnailResult> {
    // Declare tempPdfPath at the function scope so it's accessible in all blocks
    const tempPdfPath = epsPath.replace(extname(epsPath), '_temp.pdf');

    try {
      const finalOptions = { ...this.defaultOptions, ...options };
      const tempPngPath = epsPath.replace(extname(epsPath), '_temp.png');
      const thumbnailPath = await this.getThumbnailPath(epsPath, fileId, finalOptions);

      this.logger.log(`Gerando thumbnail de EPS: ${epsPath} -> ${thumbnailPath}`);

      // Ensure directory exists
      await fs.mkdir(dirname(tempPngPath), { recursive: true });

      // Determine DPI based on requested size - use high-res DPI for large thumbnails
      const isHighRes = finalOptions.width >= 1200 || finalOptions.height >= 1200;
      const density = isHighRes
        ? THUMBNAIL_CONFIG.generation.epsHighResDpi
        : THUMBNAIL_CONFIG.generation.epsDpi;

      this.logger.log(`Using ${isHighRes ? 'HIGH-RES' : 'standard'} DPI: ${density} for size ${finalOptions.width}x${finalOptions.height}`);

      const targetSize = Math.max(finalOptions.width, finalOptions.height) * 3;

      // DIRECT APPROACH: Convert EPS directly to PNG with proper cropping
      this.logger.log('Converting EPS directly to PNG with EPSCrop...');

      // Test if the EPS file can be read by Ghostscript first
      try {
        const testCommand = `${GS_BINARY} -dNOPAUSE -dBATCH -dSAFER -sDEVICE=nullpage -dQuiet "${epsPath}"`;
        this.logger.log(`Testing EPS file readability: ${testCommand}`);
        await execAsync(testCommand, { timeout: 10000 });
        this.logger.log(`EPS file ${epsPath} is readable by Ghostscript`);
      } catch (testError: any) {
        this.logger.warn(`EPS file test failed: ${testError.message}`);
        // Continue anyway, might still work for conversion
      }

      // Primary method: Two-step conversion - EPS to PDF (with proper cropping), then PDF to PNG
      // This approach handles EPS files with content outside page boundaries correctly
      try {
        // Step 1: Convert EPS to PDF with EPSCrop to properly handle bounding box
        const epsToPdfCommand = [
          GS_BINARY,
          '-dNOPAUSE',
          '-dBATCH',
          '-dSAFER',
          '-sDEVICE=pdfwrite',
          '-dEPSCrop', // Critical: Crops to actual EPS content, not page boundaries
          '-dAutoRotatePages=/None',
          `-sOutputFile="${tempPdfPath}"`,
          `"${epsPath}"`,
        ].join(' ');

        this.logger.log(`Step 1 - Converting EPS to PDF with proper cropping: ${epsToPdfCommand}`);

        const pdfResult = await execAsync(epsToPdfCommand, {
          timeout: 30000,
          killSignal: 'SIGTERM',
        });

        this.logger.log(
          `EPS to PDF conversion completed successfully. Output: ${pdfResult.stdout || 'No stdout'}`,
        );

        if (pdfResult.stderr && pdfResult.stderr.trim()) {
          this.logger.warn(`EPS to PDF warnings: ${pdfResult.stderr}`);
        }

        // Step 2: Convert the cropped PDF to PNG with transparency support
        // Use the same density as determined earlier for consistency
        const pdfToPngCommand = [
          GS_BINARY,
          '-dNOPAUSE',
          '-dBATCH',
          '-dSAFER',
          '-sDEVICE=pngalpha', // Use pngalpha for transparency support
          `-r${density}`, // Use dynamic DPI based on requested size
          '-dTextAlphaBits=4',
          '-dGraphicsAlphaBits=4',
          '-dQuiet',
          `-dFirstPage=1`,
          `-dLastPage=1`,
          '-dUseCropBox', // Use crop box if available for better content detection
          `-sOutputFile="${tempPngPath}"`,
          `"${tempPdfPath}"`,
        ].join(' ');

        this.logger.log(`Step 2 - Converting PDF to PNG: ${pdfToPngCommand}`);

        const pngResult = await execAsync(pdfToPngCommand, {
          timeout: 30000,
          killSignal: 'SIGTERM',
        });

        this.logger.log(
          `PDF to PNG conversion completed successfully. Output: ${pngResult.stdout || 'No stdout'}`,
        );

        if (pngResult.stderr && pngResult.stderr.trim()) {
          this.logger.warn(`PDF to PNG warnings: ${pngResult.stderr}`);
        }

        // Note: Keep the PDF file for potential fallback use, will clean up at the end
      } catch (gsError: any) {
        this.logger.warn(`Ghostscript failed: ${gsError.message}`);
        this.logger.log('Trying ImageMagick as fallback...');

        // Fallback to ImageMagick with better EPS handling
        // ImageMagick can sometimes handle EPS bounding boxes better than direct Ghostscript
        const magickCommand = [
          'magick',
          '-density',
          `${density}`,
          `"${epsPath}[0]"`,
          '-background',
          'white',
          '-alpha',
          'remove',
          '-alpha',
          'off',
          '-colorspace',
          'sRGB',
          '-trim', // Re-enabled trim as ImageMagick handles it differently than Ghostscript
          '+repage', // Reset page geometry after trim
          '-resize',
          `${targetSize}x${targetSize}>`, // Only shrink if larger
          '-gravity',
          'center',
          '-extent',
          `${targetSize}x${targetSize}`, // Ensure consistent size with padding if needed
          '-quality',
          '95',
          `"${tempPngPath}"`,
        ].join(' ');

        this.logger.log(`Converting EPS to PNG with ImageMagick: ${magickCommand}`);

        const magickResult = await execAsync(magickCommand, {
          timeout: 30000, // Also reduced timeout for ImageMagick
          killSignal: 'SIGTERM',
        });

        this.logger.log(
          `ImageMagick completed successfully for ${epsPath}. Output: ${magickResult.stdout || 'No stdout'}`,
        );

        if (magickResult.stderr && magickResult.stderr.trim()) {
          this.logger.warn(`ImageMagick warnings for ${epsPath}: ${magickResult.stderr}`);
        }
      }

      // Verify temp file was created and has content
      try {
        const stats = await fs.stat(tempPngPath);
        if (stats.size === 0) {
          throw new Error('Arquivo temporário está vazio');
        }
        this.logger.log(
          `Arquivo temporário criado com sucesso: ${tempPngPath} (${stats.size} bytes)`,
        );
      } catch (e) {
        throw new Error(`Arquivo temporário não foi criado ou está vazio: ${tempPngPath}`);
      }

      // Post-process with sharp for optimization
      // First, check image dimensions to avoid pixel limit errors
      try {
        const metadata = await sharp(tempPngPath).metadata();
        this.logger.log(`Temp PNG dimensions: ${metadata.width}x${metadata.height}`);

        // If image is extremely large, resize in multiple steps to avoid pixel limit
        const maxDimension = 16384; // Sharp's typical pixel limit per dimension

        if (metadata.width > maxDimension || metadata.height > maxDimension) {
          this.logger.warn(
            `Image exceeds max dimension (${maxDimension}px), using alternative approach`,
          );

          // Use Ghostscript to create the final thumbnail directly from the cropped PDF
          // This preserves the proper cropping from the EPS->PDF conversion
          // Use half the density for large images to avoid memory issues while maintaining quality
          const largeDensity = Math.floor(density / 2);
          const finalGsCommand = [
            GS_BINARY,
            '-dNOPAUSE',
            '-dBATCH',
            '-dSAFER',
            '-sDEVICE=pngalpha', // Use pngalpha for transparency support
            `-r${largeDensity}`, // Use adjusted resolution based on requested size
            '-dTextAlphaBits=4',
            '-dGraphicsAlphaBits=4',
            `-g${finalOptions.width * 2}x${finalOptions.height * 2}`, // Create larger image for better processing
            '-dPDFFitPage', // Fit the PDF page to our desired size
            '-dQuiet',
            `-sOutputFile="${tempPngPath}"`, // Output to temp PNG for Sharp processing
            `"${tempPdfPath}"`, // Use the cropped PDF, not original EPS
          ].join(' ');

          // Then process with Sharp for contrast enhancement
          await execAsync(finalGsCommand, { timeout: 30000 });

          // Apply Sharp processing with contrast enhancement and white background
          await sharp(tempPngPath)
            .flatten({ background: { r: 255, g: 255, b: 255 } }) // Add white background
            .normalize() // Auto-adjust levels
            .linear(1.3, -15) // Increase contrast more aggressively
            .resize(finalOptions.width, finalOptions.height, {
              fit: finalOptions.fit as any,
              kernel: sharp.kernel.lanczos3,
              background: { r: 255, g: 255, b: 255 }, // White background
            })
            .sharpen(1, 1, 2)
            .webp({
              // Use WebP format
              quality: 100,
              effort: 6,
            })
            .toFile(thumbnailPath);

          // Note: Large temp PNG will be cleaned up at the end
        } else {
          // Normal processing with Sharp for reasonable-sized images
          // Apply image enhancements with white background for better visibility
          await sharp(tempPngPath)
            .flatten({ background: { r: 255, g: 255, b: 255 } }) // Add white background
            .normalize() // Auto-adjust levels for better contrast
            .linear(1.2, -10) // Increase contrast and reduce brightness to make light content more visible
            .resize(finalOptions.width, finalOptions.height, {
              fit: finalOptions.fit as any,
              withoutEnlargement: true,
              kernel: sharp.kernel.lanczos3,
              background: { r: 255, g: 255, b: 255 }, // White background
            })
            .sharpen(1, 1, 2) // Add slight sharpening for better visibility in small thumbnails
            .webp({
              // Use WebP format
              quality: 100,
              effort: 6,
            })
            .toFile(thumbnailPath); // Use WebP extension from thumbnailPath
        }
      } catch (sharpError: any) {
        this.logger.error(`Sharp processing failed: ${sharpError.message}`);

        // Final fallback: Create a transparent PNG thumbnail from the cropped PDF
        // This preserves the proper cropping we got from EPS->PDF conversion
        const pngThumbnailPath = thumbnailPath.replace(/\.(webp|jpg|jpeg)$/, '.png');
        const fallbackCommand = [
          GS_BINARY,
          '-dNOPAUSE',
          '-dBATCH',
          '-dSAFER',
          '-sDEVICE=pngalpha', // Use pngalpha for transparency
          '-r72',
          `-g${finalOptions.width}x${finalOptions.height}`,
          '-dPDFFitPage', // Fit the PDF content to our desired size
          '-dTextAlphaBits=4',
          '-dGraphicsAlphaBits=4',
          `-sOutputFile="${pngThumbnailPath}"`,
          `"${tempPdfPath}"`, // Use the cropped PDF, not original EPS
        ].join(' ');

        this.logger.log(
          `Fallback: Creating transparent PNG thumbnail from cropped PDF with Ghostscript`,
        );
        try {
          await execAsync(fallbackCommand, { timeout: 30000 });

          // Apply contrast enhancement with Sharp if possible
          try {
            await sharp(pngThumbnailPath)
              .flatten({ background: { r: 255, g: 255, b: 255 } }) // Add white background
              .normalize()
              .linear(1.2, -10) // Enhance contrast
              .sharpen(1, 1, 2)
              .webp({ quality: 100, effort: 6 }) // Use WebP format
              .toFile(thumbnailPath);

            // Remove the unenhanced PNG version
            await fs.unlink(pngThumbnailPath);
            this.logger.log(`Enhanced PNG thumbnail with Sharp successfully`);
          } catch (enhanceError) {
            // If enhancement fails, convert basic PNG to WebP
            this.logger.warn(
              `Failed to enhance PNG, converting basic version to WebP: ${enhanceError}`,
            );
            try {
              // Try simple conversion to WebP
              await sharp(pngThumbnailPath)
                .flatten({ background: { r: 255, g: 255, b: 255 } }) // Add white background
                .webp({ quality: 100 })
                .toFile(thumbnailPath);
              await fs.unlink(pngThumbnailPath);
            } catch (convertError) {
              // If even simple conversion fails, just keep the PNG
              this.logger.error(`Failed to convert to WebP, keeping PNG: ${convertError}`);
            }
          }
        } catch (fallbackError: any) {
          this.logger.error(`Final fallback failed: ${fallbackError.message}`);
          throw new Error(`Unable to generate thumbnail: ${fallbackError.message}`);
        }
      }

      // Clean up temp files (but keep tempPdfPath for potential fallback use)
      try {
        await fs.access(tempPngPath);
        await fs.unlink(tempPngPath);
        this.logger.debug(`Cleaned up temporary PNG: ${tempPngPath}`);
      } catch (error) {
        this.logger.debug(`Temp PNG cleanup skipped (file may not exist): ${tempPngPath}`);
      }

      // Only clean up PDF after we're completely done
      try {
        await fs.access(tempPdfPath);
        await fs.unlink(tempPdfPath);
        this.logger.debug(`Cleaned up temporary PDF: ${tempPdfPath}`);
      } catch (error) {
        this.logger.debug(`Temp PDF cleanup skipped (file may not exist): ${tempPdfPath}`);
      }

      const thumbnailUrl = this.generateThumbnailUrl(thumbnailPath, fileId);

      this.logger.log(`Thumbnail de EPS gerado com sucesso: ${thumbnailUrl}`);

      return {
        success: true,
        thumbnailPath,
        thumbnailUrl,
      };
    } catch (error: any) {
      this.logger.error(`Falha ao gerar thumbnail de EPS para ${epsPath}:`, error);

      // Clean up any temp files in case of error
      const tempPngPath = epsPath.replace(extname(epsPath), '_temp.png');
      const tempFiles = [tempPngPath, tempPdfPath];
      for (const tempFile of tempFiles) {
        try {
          await fs.access(tempFile);
          await fs.unlink(tempFile);
          this.logger.debug(`Cleaned up temp file after error: ${tempFile}`);
        } catch (cleanupError) {
          // Ignore cleanup errors
        }
      }

      if (
        error.message.includes('convert') ||
        error.message.includes('magick') ||
        error.message.includes('gs')
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

    // Use WebDAVService to get the folder path for thumbnails
    const thumbnailFolder = this.webdavService.getWebDAVFolderPath(
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

    // Ensure the WebDAV directory exists
    await this.webdavService.ensureWebDAVDirectory(thumbnailFolder);

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
      // Fallback to WebDAV URL if fileId is not provided (shouldn't happen)
      return this.webdavService.getWebDAVUrl(thumbnailPath);
    }

    // Generate API endpoint URL for thumbnail
    // This works in both development and production
    const baseUrl = process.env.API_BASE_URL || 'http://localhost:3030';
    return `${baseUrl}/files/thumbnail/${fileId}`;
  }

  /**
   * Delete thumbnail files
   */
  async deleteThumbnails(fileId: string): Promise<void> {
    try {
      // Delete thumbnails from all size directories in WebDAV
      for (const [size, dimensions] of Object.entries(this.thumbnailSizes)) {
        const thumbnailSize = `${dimensions.width}x${dimensions.height}`;

        // Find and delete thumbnails with different formats
        const formats = ['png', 'jpg', 'webp'];
        for (const format of formats) {
          const thumbnailFilename = `${fileId}_${thumbnailSize}.${format}`;

          // Get WebDAV folder path for thumbnails
          const thumbnailFolder = this.webdavService.getWebDAVFolderPath(
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

          // Use WebDAVService to delete the file
          await this.webdavService.deleteFromWebDAV(thumbnailPath);
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
