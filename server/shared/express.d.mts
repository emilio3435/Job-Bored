declare module "express" {
  import type { IncomingMessage, Server, ServerResponse } from "node:http";

  export interface Request extends IncomingMessage {
    body: unknown;
    params: Record<string, string>;
    path: string;
    protocol: string;
    query: Record<string, string | string[] | undefined>;
    secure: boolean;
    get(name: string): string | undefined;
  }

  export interface Response extends ServerResponse<IncomingMessage> {
    json(body: unknown): this;
    sendStatus(statusCode: number): this;
    status(statusCode: number): this;
  }

  export type NextFunction = (error?: unknown) => void;
  export type RequestHandler = (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => unknown;
  export type ErrorRequestHandler = (
    error: unknown,
    req: Request,
    res: Response,
    next: NextFunction,
  ) => unknown;

  export interface Application {
    get(path: string, ...handlers: RequestHandler[]): this;
    post(path: string, ...handlers: RequestHandler[]): this;
    put(path: string, ...handlers: RequestHandler[]): this;
    use(...handlers: RequestHandler[]): this;
    use(...handlers: ErrorRequestHandler[]): this;
    listen(port: number, host: string, callback?: () => void): Server;
  }

  export interface ExpressFactory {
    (): Application;
    json(options?: { limit?: string | number }): RequestHandler;
    static(
      root: string,
      options?: { extensions?: string[]; index?: string | boolean },
    ): RequestHandler;
  }

  const express: ExpressFactory;
  export default express;
}
