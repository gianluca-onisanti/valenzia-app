/** Erro com status HTTP, que o handler global devolve como `{ error }`. */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

export const notFound = (what: string) => new HttpError(404, what + ' nao encontrado')
export const conflict = (message: string) => new HttpError(409, message)
export const badRequest = (message: string) => new HttpError(400, message)
