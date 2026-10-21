import type { FileContents, FileDriver, FileEntry, FileEvent, FileStat, Unsubscribe } from '../types';
import type { AtriumBridge } from './bridge';

/**
 * Files on this machine, read and watched in the main process.
 *
 * Watches are numbered here and matched up on the way back: the bridge
 * carries plain values, so a handler cannot cross it, only an id can.
 */
export class ElectronFiles implements FileDriver {
  private bridge: AtriumBridge;
  private handlers = new Map<number, (event: FileEvent) => void>();
  private nextId = 1;

  constructor(bridge: AtriumBridge) {
    this.bridge = bridge;
    bridge.files.onChanged((id, event) => this.handlers.get(id)?.(event));
  }

  chooseDirectory(): Promise<string | null> {
    return this.bridge.files.choose();
  }

  chooseFile(): Promise<string | null> {
    return this.bridge.files.chooseFile();
  }

  chooseAny(): Promise<string | null> {
    return this.bridge.files.chooseAny();
  }

  pathOf(file: File): string | null {
    try {
      return this.bridge.files.pathOf(file) || null;
    } catch {
      // A File that did not come from disk — one a page built — has no path.
      return null;
    }
  }

  stat(path: string): Promise<FileStat | null> {
    return this.bridge.files.stat(path);
  }

  read(path: string, as?: 'text' | 'dataUrl'): Promise<FileContents> {
    return this.bridge.files.read(path, as);
  }

  list(dir: string): Promise<FileEntry[]> {
    return this.bridge.files.list(dir);
  }

  watch(path: string, handler: (event: FileEvent) => void): Unsubscribe {
    const id = this.nextId++;
    this.handlers.set(id, handler);
    void this.bridge.files.watch(id, path).catch(() => {
      // A watch that could not be set up is a file that cannot be followed;
      // the reader still has what was read.
    });
    return () => {
      this.handlers.delete(id);
      this.bridge.files.unwatch(id);
    };
  }

  openExternally(path: string): Promise<void> {
    return this.bridge.files.openExternally(path);
  }
}
