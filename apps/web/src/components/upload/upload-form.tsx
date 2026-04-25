'use client';

import { useState, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { UploadIcon, FileIcon, CheckCircleIcon, XCircleIcon, Loader2Icon } from 'lucide-react';

const ACCEPTED_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'application/pdf',
  'video/mp4',
];
const MAX_SIZE = 10 * 1024 * 1024; // 10MB
const ACCEPT_STRING = '.jpg,.jpeg,.png,.gif,.pdf,.mp4';

export function UploadForm({ token }: { token: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploaded, setUploaded] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const validateFile = useCallback((f: File): string | null => {
    if (f.size > MAX_SIZE) return 'File is too large. Maximum size is 10MB.';
    if (!ACCEPTED_TYPES.includes(f.type)) {
      return 'Unsupported file type. Accepted: JPG, PNG, GIF, PDF, MP4.';
    }
    return null;
  }, []);

  const handleFileSelect = useCallback(
    (f: File) => {
      const err = validateFile(f);
      if (err) {
        setError(err);
        setFile(null);
        return;
      }
      setError('');
      setFile(f);
    },
    [validateFile],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const dropped = e.dataTransfer.files[0];
      if (dropped) handleFileSelect(dropped);
    },
    [handleFileSelect],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  }, []);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const selected = e.target.files?.[0];
      if (selected) handleFileSelect(selected);
    },
    [handleFileSelect],
  );

  const handleUpload = useCallback(async () => {
    if (!file) return;
    setUploading(true);
    setError('');
    setProgress(0);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const xhr = new XMLHttpRequest();

      await new Promise<void>((resolve, reject) => {
        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) {
            setProgress(Math.round((e.loaded / e.total) * 100));
          }
        });

        xhr.addEventListener('load', () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve();
          } else {
            try {
              const data = JSON.parse(xhr.responseText);
              reject(new Error(data.error || 'Upload failed'));
            } catch {
              reject(new Error('Upload failed'));
            }
          }
        });

        xhr.addEventListener('error', () => reject(new Error('Network error')));
        xhr.open('POST', `/api/upload/${token}`);
        xhr.send(formData);
      });

      setUploaded(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }, [file, token]);

  if (uploaded) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
          <CheckCircleIcon className="size-16 text-green-500" />
          <h2 className="text-xl font-semibold">Upload Successful!</h2>
          <p className="text-muted-foreground max-w-sm">
            Your evidence has been uploaded. You can close this page now.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="space-y-4">
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => fileInputRef.current?.click()}
          className={`
            flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed
            p-8 text-center cursor-pointer transition-colors
            ${dragOver ? 'border-primary bg-primary/5' : 'border-muted-foreground/25 hover:border-muted-foreground/50'}
          `}
        >
          <UploadIcon className="size-10 text-muted-foreground/50" />
          <div>
            <p className="font-medium">Drag & drop your file here</p>
            <p className="text-sm text-muted-foreground">or click to browse</p>
          </div>
          <p className="text-xs text-muted-foreground">
            Accepted: JPG, PNG, GIF, PDF, MP4 — Max 10MB
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPT_STRING}
            onChange={handleInputChange}
            className="hidden"
          />
        </div>

        {error && (
          <div className="flex items-center gap-2 text-sm text-destructive">
            <XCircleIcon className="size-4 shrink-0" />
            {error}
          </div>
        )}

        {file && !uploading && (
          <div className="flex items-center gap-3 rounded-lg border p-3">
            <FileIcon className="size-5 text-muted-foreground shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{file.name}</p>
              <p className="text-xs text-muted-foreground">
                {(file.size / 1024 / 1024).toFixed(2)} MB
              </p>
            </div>
            <Button onClick={handleUpload} size="sm">
              Upload
            </Button>
          </div>
        )}

        {uploading && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <Loader2Icon className="size-4 animate-spin" />
              Uploading... {progress}%
            </div>
            <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
