export type ApiListResponse<T> = {
  items: T[];
  page: number;
  limit: number;
  total: number;
};

export type ApiOkResponse = {
  ok: true;
};
