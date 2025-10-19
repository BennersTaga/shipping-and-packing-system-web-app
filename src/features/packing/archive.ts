import { API_ENDPOINTS } from "./api";

type ArchiveParams = {
  env: string;
  year?: number | null;
  month?: number | null;
  day?: number | null;
  page?: number;
};

type ArchiveResponse = {
  success?: boolean;
  data?: any;
  meta?: any;
};

export async function fetchArchive(params: ArchiveParams): Promise<ArchiveResponse> {
  const search = new URLSearchParams();
  search.append("env", params.env);
  search.append("scope", "archive");
  if (params.year) search.append("year", String(params.year));
  if (params.month) search.append("month", String(params.month));
  if (params.day) search.append("day", String(params.day));
  search.append("paginate", "1");
  search.append("pageSize", "10");
  search.append("pageShipped", String(params.page ?? 1));

  const res = await fetch(`${API_ENDPOINTS.SEARCH_PACKING}?${search.toString()}`, {
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(res.statusText);
  }
  return res.json();
}
