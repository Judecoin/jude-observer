import { EXPLORER_PAGE_SIZE, EXPLORER_PAGE_SIZES } from "./constants";

export function explorerPageSize(value: string | null) {
  const parsed = Number.parseInt(value || String(EXPLORER_PAGE_SIZE), 10);
  return EXPLORER_PAGE_SIZES.has(parsed) ? parsed : EXPLORER_PAGE_SIZE;
}
