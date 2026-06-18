import type { HistogramBucket } from "@/data/bootstrap-types";

export type HistogramSeries = { name: string; histogram: HistogramBucket[]; color?: string };
export type CategoryDatum = { name: string; value: number };
export type DistributionSlice = { id: string; label: string; count: number; fill?: string };

export type ScatterPoint = {
  x: number;
  y: number;
  name: string;
  group?: string;
};
