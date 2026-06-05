'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { AlertCircle, Upload, Download, Pin, Trash2, Eye, Copy, ExternalLink } from 'lucide-react';

interface IPFSFile {
  cid: string;
  name: string;
  size: number;
  type: string;
  pinned: boolean;
  uploadedAt: string;
  description?: string;
}

interface IPFSStats {
  totalFiles: number;
  totalSize: number;
  pinnedFiles: number;
  storageUsed: number;
  storageLimit: number;
}

// Mock IPFS operations - replace with real IPFS client
class MockIPFSClient {
  private files: IPFSFile[] = [
    {
      cid: 'QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco',
      name: 'project-design.fig',
      size: 2456789,
      type: 'application/octet-stream',
      pinned: true,
      uploadedAt: '2024-01-15T10:30:00Z',
      description: 'Main design file for the mobile app project'
    },
    {
      cid: 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG',
      name: 'portfolio-images.zip',
      size: 15678901,
      type: 'application/zip',
      pinned: true,
      uploadedAt: '2024-01-14T15:45:00Z',
      description: 'High-resolution portfolio images'
    },
    {
      cid: 'QmNjBAAvuYKD1gR6EbEG8h6xJ9K7K8K8K8K8K8K8K8K8',
      name: 'project-docs.pdf',
      size: 1234567,
      type: 'application/pdf',
      pinned: false,
      uploadedAt: '2024-01-13T09:15:00Z',
      description: 'Project documentation and specifications'
    }
  ];

  async listFiles(): Promise<IPFSFile[]> {
    await new Promise(resolve => setTimeout(resolve, 800)); // Simulate network delay
    return [...this.files];
  }

  async uploadFile(file: File, description?: string): Promise<IPFSFile> {
    await new Promise(resolve => setTimeout(resolve, 2000)); // Simulate upload
    
    const newFile: IPFSFile = {
      cid: `Qm${Math.random().toString(36).substr(2, 43)}`, // Mock CID
      name: file.name,
      size: file.size,
      type: file.type,
      pinned: true,
      uploadedAt: new Date().toISOString(),
      description
    };
    
    this.files.unshift(newFile);
    return newFile;
  }

  async deleteFile(cid: string): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, 500));
    this.files = this.files.filter(f => f.cid !== cid);
  }

  async pinFile(cid: string): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, 300));
    const file = this.files.find(f => f.cid === cid);
    if (file) file.pinned = true;
  }

  async unpinFile(cid: string): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, 300));
    const file = this.files.find(f => f.cid === cid);
    if (file) file.pinned = false;
  }

  getStats(): IPFSStats {
    const totalFiles = this.files.length;
    const totalSize = this.files.reduce((sum, f) => sum + f.size, 0);
    const pinnedFiles = this.files.filter(f => f.pinned).length;
    
    return {
      totalFiles,
      totalSize,
      pinnedFiles,
      storageUsed: totalSize,
      storageLimit: 100 * 1024 * 1024 * 1024, // 100GB
    };
  }
}

const ipfsClient = new MockIPFSClient();

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

interface FileListProps {
  files: IPFSFile[];
  loading: boolean;
  onPin: (cid: string) => void;
  onUnpin: (cid: string) => void;
  onDelete: (cid: string) => void;
  onView: (file: IPFSFile) => void;
}

function FileList({ files, loading, onPin, onUnpin, onDelete, onView }: FileListProps) {
  const [filter, setFilter] = useState('');

  const filteredFiles = files.filter(file => 
    file.name.toLowerCase().includes(filter.toLowerCase()) ||
    file.description?.toLowerCase().includes(filter.toLowerCase())
  );

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map(i => (
          <div key={i} className="animate-pulse">
            <div className="h-20 bg-muted rounded-lg"></div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor="file-filter">Filter files</Label>
        <Input
          id="file-filter"
          placeholder="Search by name or description..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="mt-1"
        />
      </div>

      <div className="space-y-2">
        {filteredFiles.map((file) => (
          <Card key={file.cid} className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-medium truncate">{file.name}</h3>
                  {file.pinned && <Badge variant="secondary" className="text-xs">Pinned</Badge>}
                </div>
                <div className="text-sm text-muted-foreground space-y-1">
                  <p>{formatBytes(file.size)} • {formatDate(file.uploadedAt)}</p>
                  {file.description && (
                    <p className="text-xs">{file.description}</p>
                  )}
                  <p className="font-mono text-xs break-all">
                    {file.cid}
                  </p>
                </div>
              </div>
              
              <div className="flex items-center gap-2 ml-4">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => onView(file)}
                  title="View file"
                >
                  <Eye className="h-4 w-4" />
                </Button>
                
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => navigator.clipboard.writeText(file.cid)}
                  title="Copy CID"
                >
                  <Copy className="h-4 w-4" />
                </Button>

                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => window.open(`https://ipfs.io/ipfs/${file.cid}`, '_blank')}
                  title="Open in IPFS gateway"
                >
                  <ExternalLink className="h-4 w-4" />
                </Button>
                
                {file.pinned ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => onUnpin(file.cid)}
                    title="Unpin file"
                  >
                    <Pin className="h-4 w-4 text-blue-500" />
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => onPin(file.cid)}
                    title="Pin file"
                  >
                    <Pin className="h-4 w-4" />
                  </Button>
                )}
                
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => onDelete(file.cid)}
                  className="text-destructive"
                  title="Delete file"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </Card>
        ))}
        
        {filteredFiles.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            {files.length === 0 ? 'No files uploaded yet' : 'No files match your filter'}
          </div>
        )}
      </div>
    </div>
  );
}

interface UploadFormProps {
  onUpload: (file: File, description?: string) => void;
  uploading: boolean;
}

function UploadForm({ onUpload, uploading }: UploadFormProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [description, setDescription] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedFile) {
      onUpload(selectedFile, description);
      setSelectedFile(null);
      setDescription('');
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Upload className="h-5 w-5" />
          Upload to IPFS
        </CardTitle>
        <CardDescription>
          Upload files to the InterPlanetary File System for decentralized storage
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="file-input">Select file</Label>
            <Input
              id="file-input"
              type="file"
              onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
              disabled={uploading}
              className="mt-1"
            />
          </div>
          
          <div>
            <Label htmlFor="description">Description (optional)</Label>
            <Textarea
              id="description"
              placeholder="Describe this file..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={uploading}
              className="mt-1"
            />
          </div>
          
          <Button type="submit" disabled={!selectedFile || uploading}>
            {uploading ? 'Uploading...' : 'Upload File'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

export function IpfsStorageBrowser() {
  const [files, setFiles] = useState<IPFSFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadFiles = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const fileList = await ipfsClient.listFiles();
      setFiles(fileList);
    } catch (err) {
      setError('Failed to load files from IPFS');
      console.error('IPFS load error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadFiles();
  }, [loadFiles]);

  const handleUpload = async (file: File, description?: string) => {
    try {
      setUploading(true);
      setError(null);
      await ipfsClient.uploadFile(file, description);
      await loadFiles(); // Refresh file list
    } catch (err) {
      setError('Failed to upload file to IPFS');
      console.error('IPFS upload error:', err);
    } finally {
      setUploading(false);
    }
  };

  const handlePin = async (cid: string) => {
    try {
      await ipfsClient.pinFile(cid);
      await loadFiles();
    } catch (err) {
      setError('Failed to pin file');
    }
  };

  const handleUnpin = async (cid: string) => {
    try {
      await ipfsClient.unpinFile(cid);
      await loadFiles();
    } catch (err) {
      setError('Failed to unpin file');
    }
  };

  const handleDelete = async (cid: string) => {
    if (!confirm('Are you sure you want to delete this file?')) return;
    
    try {
      await ipfsClient.deleteFile(cid);
      await loadFiles();
    } catch (err) {
      setError('Failed to delete file');
    }
  };

  const handleView = (file: IPFSFile) => {
    window.open(`https://ipfs.io/ipfs/${file.cid}`, '_blank');
  };

  const stats = ipfsClient.getStats();
  const storagePercentage = (stats.storageUsed / stats.storageLimit) * 100;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">IPFS Storage Browser</h1>
        <p className="text-muted-foreground mt-1">
          Manage your decentralized file storage on IPFS
        </p>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-4 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive">
          <AlertCircle className="h-5 w-5" />
          <span>{error}</span>
        </div>
      )}

      {/* Storage Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">{stats.totalFiles}</div>
            <p className="text-xs text-muted-foreground">Total Files</p>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">{stats.pinnedFiles}</div>
            <p className="text-xs text-muted-foreground">Pinned Files</p>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">{formatBytes(stats.totalSize)}</div>
            <p className="text-xs text-muted-foreground">Total Size</p>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="pt-6">
            <div className="space-y-2">
              <div className="text-sm font-medium">Storage Used</div>
              <Progress value={storagePercentage} className="h-2" />
              <p className="text-xs text-muted-foreground">
                {formatBytes(stats.storageUsed)} of {formatBytes(stats.storageLimit)}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="files" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="files">My Files</TabsTrigger>
          <TabsTrigger value="upload">Upload</TabsTrigger>
        </TabsList>
        
        <TabsContent value="files" className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Files on IPFS</h2>
            <Button onClick={loadFiles} variant="outline" size="sm">
              Refresh
            </Button>
          </div>
          
          <FileList
            files={files}
            loading={loading}
            onPin={handlePin}
            onUnpin={handleUnpin}
            onDelete={handleDelete}
            onView={handleView}
          />
        </TabsContent>
        
        <TabsContent value="upload" className="space-y-4">
          <UploadForm onUpload={handleUpload} uploading={uploading} />
        </TabsContent>
      </Tabs>
    </div>
  );
}