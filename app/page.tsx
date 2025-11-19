'use client';

import React, { useState, useCallback } from 'react';
import SvgPath from 'svgpath';
import JSZip from 'jszip';
import { Upload, Download, Trash2, Settings, FileCode, RefreshCw, CheckCircle } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// --- Utilities ---
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// --- Types ---
interface ProcessedFile {
  id: string;
  name: string;
  originalContent: string;
  processedContent: string | null;
  status: 'pending' | 'success' | 'error';
  message?: string;
}

export default function SvgNormalizer() {
  const [files, setFiles] = useState<ProcessedFile[]>([]);
  const [targetSize, setTargetSize] = useState<number>(24);
  const [isProcessing, setIsProcessing] = useState(false);

  // --- The Core Logic (Adapted from your Node script) ---
  const processSvgContent = (content: string, size: number): string => {
    let minX = 0;
    let minY = 0;
    let oldWidth: number | null = null;
    let oldHeight: number | null = null;

    // 1) Try to read from viewBox
    const vbMatch = content.match(/viewBox="([^"]+)"/i);
    if (vbMatch) {
      const parts = vbMatch[1].trim().split(/\s+/).map(Number);
      if (parts.length === 4 && parts.every((n) => !isNaN(n))) {
        [minX, minY, oldWidth, oldHeight] = parts;
      }
    }

    // 2) Fallback: try width/height attributes
    if (oldWidth === null || oldHeight === null) {
      const wMatch = content.match(/\swidth="([\d.]+)(px)?"/i);
      const hMatch = content.match(/\sheight="([\d.]+)(px)?"/i);
      if (wMatch && hMatch) {
        oldWidth = parseFloat(wMatch[1]);
        oldHeight = parseFloat(hMatch[1]);
        minX = 0;
        minY = 0;
      }
    }

    if (!oldWidth || !oldHeight) {
      throw new Error("Could not detect original dimensions");
    }

    // 3) Compute scale factors
    const scaleX = size / oldWidth;
    const scaleY = size / oldHeight;

    // 4) Transform all <path> d attributes
    // Note: We use a safer regex approach for the browser or DOMParser could be used,
    // but regex keeps it consistent with your original logic which works well for standard SVGs.
    let newContent = content.replace(/<path([^>]*)d="([^"]+)"([^>]*)>/gi, (match, pre, d, post) => {
        try {
            let p = new SvgPath(d);

            // If viewBox starts at non-zero, normalize origin to (0, 0)
            if (minX !== 0 || minY !== 0) {
                p = p.translate(-minX, -minY);
            }

            // Scale into the new coordinate system
            p = p.scale(scaleX, scaleY);
            
            // Round to 3 decimal places to save space
            const newD = p.round(3).toString();
            return `<path${pre}d="${newD}"${post}>`;
        } catch (e) {
            console.error("Error parsing path", e);
            return match; // Return original if fail
        }
    });

    // 5) Normalize the <svg> tag attributes
    // Remove existing width/height/viewBox/style/fill (optional: keeping fill allows colors)
    newContent = newContent.replace(/\s(width|height|viewBox)="[^"]*"/gi, '');
    
    // Inject new attributes. 
    // We also enforce fill="currentColor" if you want them ready for font usage/CSS coloring,
    // but for now we stick to your resizing logic.
    newContent = newContent.replace(
      /<svg([^>]*)>/i,
      `<svg$1 width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`
    );

    return newContent;
  };

  // --- Handlers ---

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newFiles: ProcessedFile[] = Array.from(e.target.files).map((file) => ({
        id: Math.random().toString(36).substr(2, 9),
        name: file.name,
        originalContent: '',
        processedContent: null,
        status: 'pending',
      }));

      // Read files
      const readers = newFiles.map((fileObj, index) => {
        const file = e.target.files![index];
        return new Promise<void>((resolve) => {
          const reader = new FileReader();
          reader.onload = (event) => {
            if (event.target?.result) {
              // Update the specific file object in our local array
              newFiles[index].originalContent = event.target.result as string;
            }
            resolve();
          };
          reader.readAsText(file);
        });
      });

      Promise.all(readers).then(() => {
        setFiles((prev) => [...prev, ...newFiles]);
        // Auto process newly added files
        processBatch(newFiles);
      });
    }
  };

  const processBatch = (batch: ProcessedFile[]) => {
    setIsProcessing(true);
    const processed = batch.map((file) => {
      try {
        const result = processSvgContent(file.originalContent, targetSize);
        return { ...file, processedContent: result, status: 'success' as const };
      } catch (err) {
        return { ...file, status: 'error' as const, message: 'Failed to scale' };
      }
    });

    setFiles((prev) => {
      // Merge processed batch back into main state
      return prev.map(f => {
        const found = processed.find(p => p.id === f.id);
        return found || f;
      });
    });
    setIsProcessing(false);
  };

  const reprocessAll = () => {
    processBatch(files);
  };

  const handleDownloadZip = async () => {
    const zip = new JSZip();
    const folder = zip.folder("icons");

    files.forEach((file) => {
      if (file.status === 'success' && file.processedContent) {
        folder?.file(file.name, file.processedContent);
      }
    });

    const content = await zip.generateAsync({ type: "blob" });
    const url = window.URL.createObjectURL(content);
    const a = document.createElement("a");
    a.href = url;
    a.download = `icons-${targetSize}px.zip`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const clearFiles = () => setFiles([]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans selection:bg-indigo-100">
      {/* Navbar */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center text-white font-bold">
              <FileCode size={20} />
            </div>
            <h1 className="text-xl font-bold text-slate-800">SVG Normalizer</h1>
          </div>
          <div className="flex items-center gap-4">
            <a 
              href="https://github.com" 
              target="_blank" 
              className="text-sm font-medium text-slate-500 hover:text-slate-900 transition-colors"
            >
              GitHub
            </a>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8 grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* Sidebar / Controls */}
        <div className="lg:col-span-4 space-y-6">
          
          {/* Upload Card */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Upload size={20} className="text-indigo-600" />
              Upload SVGs
            </h2>
            <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-slate-300 rounded-lg cursor-pointer bg-slate-50 hover:bg-slate-100 hover:border-indigo-500 transition-all group">
              <div className="flex flex-col items-center justify-center pt-5 pb-6">
                <Upload className="w-8 h-8 mb-2 text-slate-400 group-hover:text-indigo-600 transition-colors" />
                <p className="text-sm text-slate-500 text-center">
                  <span className="font-semibold text-indigo-600">Click to upload</span> or drag and drop
                </p>
                <p className="text-xs text-slate-400 mt-1">SVG files only</p>
              </div>
              <input 
                type="file" 
                className="hidden" 
                multiple 
                accept=".svg" 
                onChange={handleFileUpload} 
              />
            </label>
          </div>

          {/* Settings Card */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Settings size={20} className="text-indigo-600" />
              Configuration
            </h2>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Target Size (px)
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={targetSize}
                    onChange={(e) => setTargetSize(Number(e.target.value))}
                    className="block w-full rounded-md border-slate-300 bg-slate-50 py-2 px-3 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm border"
                  />
                  <button 
                    onClick={reprocessAll}
                    className="p-2 bg-indigo-50 text-indigo-600 rounded-md hover:bg-indigo-100 transition-colors"
                    title="Reprocess all files with new size"
                  >
                    <RefreshCw size={18} />
                  </button>
                </div>
                <p className="text-xs text-slate-500 mt-2">
                  SVGs will be scaled to a {targetSize}x{targetSize} viewBox.
                </p>
              </div>
            </div>
          </div>

          {/* Actions */}
          {files.length > 0 && (
            <div className="flex flex-col gap-3">
              <button
                onClick={handleDownloadZip}
                className="w-full flex items-center justify-center gap-2 bg-indigo-600 text-white py-3 px-4 rounded-lg font-medium hover:bg-indigo-700 transition-colors shadow-sm hover:shadow"
              >
                <Download size={18} />
                Download All as ZIP
              </button>
              <button
                onClick={clearFiles}
                className="w-full flex items-center justify-center gap-2 bg-white text-red-600 border border-red-100 py-3 px-4 rounded-lg font-medium hover:bg-red-50 transition-colors"
              >
                <Trash2 size={18} />
                Clear List
              </button>
            </div>
          )}
        </div>

        {/* Main Content / Preview */}
        <div className="lg:col-span-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-slate-800">
              Preview ({files.length})
            </h2>
            {files.length > 0 && (
               <span className="text-sm text-slate-500 bg-white px-3 py-1 rounded-full border border-slate-200">
                 Target: {targetSize}px
               </span>
            )}
          </div>

          {files.length === 0 ? (
            <div className="bg-white rounded-xl border border-dashed border-slate-300 p-12 text-center">
              <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4">
                <FileCode className="text-slate-400" size={32} />
              </div>
              <h3 className="text-lg font-medium text-slate-900">No files uploaded</h3>
              <p className="text-slate-500 mt-1">Upload SVG files to start normalizing them.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
              {files.map((file) => (
                <div 
                  key={file.id} 
                  className="bg-white rounded-lg border border-slate-200 p-4 flex flex-col items-center relative group hover:border-indigo-300 transition-colors"
                >
                  {/* Status Indicator */}
                  <div className="absolute top-2 right-2">
                    {file.status === 'success' ? (
                      <CheckCircle size={16} className="text-green-500" />
                    ) : file.status === 'error' ? (
                      <span className="w-2 h-2 bg-red-500 rounded-full block" title="Error"></span>
                    ) : (
                      <RefreshCw size={16} className="text-slate-400 animate-spin" />
                    )}
                  </div>

                  {/* Preview */}
                  <div 
                    className="w-16 h-16 bg-slate-50 rounded flex items-center justify-center mb-3 overflow-hidden border border-slate-100"
                  >
                    {file.processedContent ? (
                      <div 
                        dangerouslySetInnerHTML={{ __html: file.processedContent }} 
                        className="text-slate-700"
                        style={{ width: targetSize, height: targetSize }} // Visually restrict size
                      />
                    ) : (
                       <div className="text-xs text-slate-400">...</div>
                    )}
                  </div>

                  {/* File Name */}
                  <p className="text-xs font-medium text-slate-700 truncate w-full text-center" title={file.name}>
                    {file.name}
                  </p>
                  <p className="text-[10px] text-slate-400 mt-1">
                    {file.status === 'success' ? `${targetSize}x${targetSize}` : 'Pending'}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

