/** 库房业务的可预期错误：状态码和给用户看的中文文案。由 routes/wh-http.ts 统一转成响应。 */
export class WarehouseError extends Error {
  constructor(
    public readonly status: 400 | 403 | 404 | 409,
    message: string
  ) {
    super(message);
    this.name = "WarehouseError";
  }
}

export const badRequest = (message: string): WarehouseError => new WarehouseError(400, message);
