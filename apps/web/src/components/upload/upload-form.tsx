'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  UploadIcon,
  FileIcon,
  CheckCircleIcon,
  XCircleIcon,
  Loader2Icon,
  CameraIcon,
  MapPinIcon,
} from 'lucide-react';

const ACCEPTED_TYPES = [
  'image/jpeg',
  'image/png',
  'image/heic',
  'image/heif',
  'application/pdf',
  'video/mp4',
];
const MAX_SIZE = 50 * 1024 * 1024; // 50MB (videos can be large)
const ACCEPT_STRING = '.jpg,.jpeg,.png,.heic,.heif,.pdf,.mp4';

interface GeoLocation {
  latitude: number;
  longitude: number;
  accuracy: number;
}

export function UploadForm({
  token,
  description,
}: {
  token: string;
  description?: string | null;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploaded, setUploaded] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [geoLocation, setGeoLocation] = useState<GeoLocation | null>(null);
  const [geoStatus, setGeoStatus] = useState<
    'idle' | 'loading' | 'success' | 'denied' | 'unavailable'
  >('idle');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setGeoStatus('loading');
    if (!navigator.geolocation) {
      setGeoStatus('unavailable');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setGeoLocation({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
        });
        setGeoStatus('success');
      },
      () => {
        setGeoStatus('denied');
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  }, []);

  const validateFile = useCallback((f: File): string | null => {
    if (f.size > MAX_SIZE) return 'File is too large. Maximum size is 50MB.';
    if (
      !ACCEPTED_TYPES.includes(f.type) &&
      !f.name.toLowerCase().endsWith('.heic') &&
      !f.name.toLowerCase().endsWith('.heif')
    ) {
      return 'Unsupported file type. Accepted: JPG, PNG, HEIC, PDF, MP4.';
    }
    return null;
  }, []);

  const handleFileSelect = useCallback(
    (f: File) => {
      const err = validateFile(f);
      if (err) {
        setError(err);
        setFile(null);
        setPreview(null);
        return;
      }
      setError('');
      setFile(f);

      if (f.type.startsWith('image/') && !f.name.toLowerCase().endsWith('.heic')) {
        const url = URL.createObjectURL(f);
        setPreview(url);
      } else {
        setPreview(null);
      }
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

      if (geoLocation) {
        formData.append('latitude', String(geoLocation.latitude));
        formData.append('longitude', String(geoLocation.longitude));
        formData.append('accuracy', String(geoLocation.accuracy));
      }

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
  }, [file, token, geoLocation]);

  if (uploaded) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
          <CheckCircleIcon className="size-16 text-green-500" />
          <h2 className="font-display text-xl font-semibold">Thank You!</h2>
          <p className="text-muted-foreground max-w-sm">
            Your evidence has been submitted successfully. You can close this
            page now.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {description && (
        <Card>
          <CardContent className="py-3">
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">Requested: </span>
              {description}
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="space-y-5">
          {/* Drop zone */}
          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={() => fileInputRef.current?.click()}
            className={`
              flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed
              p-8 text-center cursor-pointer transition-colors min-h-[160px]
              ${dragOver ? 'border-primary bg-primary/5' : 'border-muted-foreground/25 hover:border-muted-foreground/50'}
            `}
          >
            <UploadIcon className="size-10 text-muted-foreground/50" />
            <div>
              <p className="font-medium">Tap to choose a file</p>
              <p className="text-sm text-muted-foreground">
                or drag &amp; drop here
              </p>
            </div>
            <p className="text-xs text-muted-foreground">
              JPG, PNG, HEIC, PDF, MP4 — Max 50MB
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPT_STRING}
              onChange={handleInputChange}
              className="hidden"
            />
          </div>

          {/* Camera capture button — shown on all devices, browser handles support */}
          <Button
            type="button"
            variant="outline"
            className="w-full h-12 text-base gap-2"
            onClick={() => cameraInputRef.current?.click()}
          >
            <CameraIcon className="size-5" />
            Take a Photo
          </Button>
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handleInputChange}
            className="hidden"
          />

          {/* Error message */}
          {error && (
            <div className="flex items-center gap-2 text-sm text-destructive">
              <XCircleIcon className="size-4 shrink-0" />
              {error}
            </div>
          )}

          {/* File preview / selected file */}
          {file && !uploading && (
            <div className="space-y-3">
              {preview && (
                <div className="relative rounded-lg overflow-hidden border">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={preview}
                    alt="Preview"
                    className="w-full max-h-48 object-cover"
                  />
                </div>
              )}
              <div className="flex items-center gap-3 rounded-lg border p-3">
                <FileIcon className="size-5 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{file.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {(file.size / 1024 / 1024).toFixed(2)} MB
                  </p>
                </div>
              </div>

              <Button
                onClick={handleUpload}
                className="w-full h-12 text-base font-semibold"
              >
                Upload Evidence
              </Button>
            </div>
          )}

          {/* Upload progress */}
          {uploading && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm justify-center">
                <Loader2Icon className="size-4 animate-spin" />
                Uploading... {progress}%
              </div>
              <div className="h-2.5 w-full rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}

          {/* Geolocation status */}
          <div className="flex items-center gap-2 text-xs text-muted-foreground pt-1 border-t">
            <MapPinIcon className="size-3.5 shrink-0" />
            {geoStatus === 'loading' && 'Detecting location...'}
            {geoStatus === 'success' && 'Location captured for verification'}
            {geoStatus === 'denied' &&
              'Location access denied — upload still works'}
            {geoStatus === 'unavailable' &&
              'Location not available on this device'}
            {geoStatus === 'idle' && 'Requesting location access...'}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
