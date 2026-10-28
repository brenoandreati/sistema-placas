export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

export interface PageParams {
  page?: number;
  pageSize?: number;
}

export function pageArgs(params: PageParams, defaultSize = 20) {
  const pageSize = Math.min(Math.max(Math.trunc(params.pageSize ?? defaultSize) || defaultSize, 1), 200);
  const page = Math.max(Math.trunc(params.page ?? 1) || 1, 1);
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

export function paginated<T>(items: T[], total: number, page: number, pageSize: number): Paginated<T> {
  return { items, total, page, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}
