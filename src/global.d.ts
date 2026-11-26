export {};

export type OpenFile = { path: string; name: string; dir: string; xml: string };

export type SaveResult = {
  canceled: boolean;
  path?: string;
  name?: string;
  dir?: string;
  error?: string;
};

declare global {
  interface Window {
    patterner?: {
      platform: string;
      openDialog: () => Promise<{ canceled: boolean; files?: OpenFile[]; error?: string }>;
      readFile: (path: string) => Promise<OpenFile & { error?: string }>;
      save: (payload: {
        path: string | null;
        xml: string;
        defaultName?: string;
        filters?: Array<{ name: string; extensions: string[] }>;
      }) => Promise<SaveResult>;
      chooseDirectory: () => Promise<{ canceled: boolean; dir?: string }>;
      exportFile: (payload: {
        data: string;
        defaultName: string;
        filters?: Array<{ name: string; extensions: string[] }>;
        binary?: boolean;
      }) => Promise<{ canceled: boolean; path?: string; error?: string }>;
      pathForFile: (file: File) => string;
      setDirty: (value: boolean) => void;
      setTitle: (title: string | null) => void;
      quitNow: () => void;
      cancelQuit: () => void;
      writeClipboard: (text: string) => Promise<boolean>;
      readClipboard: () => Promise<string>;
      listLibrary: () => Promise<{ dir: string; entries: Array<{ name: string; file: string; mtime: number; size: number }>; error?: string }>;
      saveToLibrary: (p: { name: string; xml: string }) => Promise<{ ok: boolean; name?: string; dir?: string; error?: string }>;
      readFromLibrary: (name: string) => Promise<{ ok: boolean; xml?: string; name?: string; error?: string }>;
      deleteFromLibrary: (name: string) => Promise<{ ok: boolean; error?: string }>;
      copyFromLibrary: (p: { names: string[]; dir?: string }) => Promise<{ canceled: boolean; dir?: string; copied?: string[]; failed?: string[] }>;
      revealLibrary: () => Promise<{ dir: string }>;
      openSvgDialog: () => Promise<{ canceled: boolean; svg?: string; name?: string; path?: string; error?: string }>;
      onMenu: (cb: (action: string) => void) => () => void;
      onOpenPath: (cb: (path: string) => void) => () => void;
    };
  }
}
