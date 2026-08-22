declare module "qz-tray" {
  type PromiseVoid = Promise<void>;

  const qz: {
    websocket: {
      connect: (options?: Record<string, unknown>) => PromiseVoid;
      disconnect: () => PromiseVoid;
      isActive: () => boolean;
    };
    printers: {
      find: (query?: string) => Promise<string | string[]>;
      getDefault: () => Promise<string>;
    };
    configs: {
      create: (printer: string, options?: Record<string, unknown>) => unknown;
    };
    print: (config: unknown, data: unknown[]) => PromiseVoid;
    security: {
      setCertificatePromise: (cb: (resolve: (cert: string) => void) => void) => void;
      setSignaturePromise: (cb: (toSign: string) => (resolve: (sig: string) => void) => void) => void;
    };
  };

  export default qz;
}
