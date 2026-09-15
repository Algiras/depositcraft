declare module '@wix/app-tools/service-plugins' {
  export const toolsProvider: {
    provideHandlers(handlers: {
      runTool(context: { request: { methodName: string } }): Promise<{ response: Record<string, unknown> }>;
    }): void;
  };
}
