import type { DataQualityColumnMapping, DataQualityConfiguration, DataQualityResult } from "@/api/types";

/**
 * Which optional columns the Data Quality table shows. A result table set up without a rule column
 * gets no empty Rule column: each optional column appears when a result table maps it, or when the
 * rows themselves carry a value.
 */
export interface ResultColumns { dataset: boolean; rule: boolean; failedRows: boolean }

export function resultColumns(tables: Array<Pick<DataQualityConfiguration, "mapping">>, rows: DataQualityResult[]): ResultColumns {
  const mapped = (key: keyof DataQualityColumnMapping) => tables.some((table) => Boolean(table.mapping?.[key]));
  return {
    dataset: mapped("dataset") || rows.some((item) => Boolean(item.dataset)),
    rule: mapped("rule") || rows.some((item) => Boolean(item.rule)),
    failedRows: mapped("failedRows") || rows.some((item) => Number(item.failedRows) > 0),
  };
}
