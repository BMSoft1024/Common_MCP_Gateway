import { watch, existsSync, FSWatcher } from 'fs';
import { dirname, basename } from 'path';
import { getLogger } from './logger';

export class PolicyWatcher {
  private watchers: FSWatcher[] = [];
  private debounceTimer?: NodeJS.Timeout;
  private logger = getLogger();

  constructor(private onChanged: () => void) {}

  watchPaths(policyPath?: string, configPath?: string): void {
    this.close();

    if (configPath) {
      this.addFileWatcher(configPath);
    }

    if (policyPath) {
      this.addFileWatcher(policyPath);
    }
  }

  private watchedDirs = new Map<string, Set<string>>();

  // fs.watch on a file path stops reporting after atomic replace (temp+rename),
  // which is how most editors and config writers save. Watching the parent
  // directory and filtering by file name survives replaces and also catches
  // the file being created later.
  private addFileWatcher(path: string): void {
    const dir = dirname(path);
    const fileName = basename(path);
    if (!existsSync(dir)) return;

    let names = this.watchedDirs.get(dir);
    if (!names) {
      names = new Set<string>();
      this.watchedDirs.set(dir, names);
      try {
        const watcher = watch(dir, (_eventType, changed) => {
          if (changed && names!.has(changed.toString())) {
            this.trigger();
          }
        });
        this.watchers.push(watcher);
      } catch (error) {
        this.logger.warn({
          message: 'Failed to watch directory',
          dir,
          error: (error as Error).message
        });
        this.watchedDirs.delete(dir);
        return;
      }
    }
    names.add(fileName);
  }

  private trigger(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      try {
        this.onChanged();
      } catch (error) {
        this.logger.warn({
          message: 'Policy change handler failed',
          error: (error as Error).message
        });
      }
    }, 300);
  }

  close(): void {
    for (const watcher of this.watchers) {
      try {
        watcher.close();
      } catch {
        // ignore
      }
    }
    this.watchers = [];
    this.watchedDirs.clear();
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = undefined;
    }
  }
}
