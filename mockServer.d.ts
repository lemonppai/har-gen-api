export declare const mockServer: (options?: {
  include?: string;
  baseURL?: string;
  enabled?: boolean;
  debug?: boolean;
}) => {
  name: string;
  configureServer(server: any): void;
};
