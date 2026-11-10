import type { ReactNode } from 'react';
import type { Format } from '@/lib/format';

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Rec = Record<string, any>;

export type Option = { value: string; label: string };

/** A form field. Values are converted to the right JSON type before sending. */
export type FieldDef = {
  name: string;
  label: string;
  type?: 'text' | 'number' | 'date' | 'datetime' | 'textarea' | 'select' | 'checkbox' | 'lines' | 'numberList';
  options?: (string | Option)[];
  /** Load select options from the API: data[dataKey] mapped with value/label. */
  optionsFrom?: { path: string; dataKey: string; value: (r: Rec) => string; label: (r: Rec) => string };
  required?: boolean;
  hint?: string;
  initial?: (record: Rec) => unknown;
  /** Send null instead of omitting when left empty. */
  nullable?: boolean;
};

/** A button that calls the API, optionally after a form. */
export type ActionDef = {
  label: string;
  method?: 'post' | 'put' | 'delete';
  path: (record: Rec) => string;
  fields?: FieldDef[];
  /** Shown before running an action without fields. */
  confirm?: string | ((record: Rec) => string);
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  when?: (record: Rec) => boolean;
  body?: (values: Rec, record: Rec) => unknown;
  /** Permission needed (adm.<module>.<action>); hidden from employees without it. */
  perm?: string;
};

export type ColumnDef = { key: string; label: string; format?: Format; render?: (row: Rec) => ReactNode };

export type TableSection = {
  kind: 'table';
  title?: string;
  /** A respondList endpoint: returns { items, total, page, pageSize, columns }. */
  path: string;
  filter?: { param: string; tabs: Option[] };
  /** Fixed extra query parameters. */
  query?: Record<string, string>;
  rowHref?: (row: Rec) => string;
  rowActions?: ActionDef[];
  actions?: ActionDef[];
  exportable?: boolean;
  dateRange?: boolean;
};

export type ItemsSection = {
  kind: 'items';
  title?: string;
  path: string;
  dataKey?: string;
  columns?: ColumnDef[];
  filter?: { param: string; tabs: Option[] };
  rowHref?: (row: Rec) => string;
  rowActions?: ActionDef[];
  actions?: ActionDef[];
  stats?: (data: Rec) => { label: string; value: ReactNode }[];
  paged?: boolean;
};

export type KvSection = { kind: 'kv'; title?: string; path: string; dataKey?: string; actions?: ActionDef[] };

export type SectionDef = TableSection | ItemsSection | KvSection;

export type DetailTab = { label: string; path?: (id: string) => string; view?: (data: Rec) => unknown };

export type DetailDef = {
  path: (id: string) => string;
  title: (data: Rec) => string;
  subtitle?: (data: Rec) => ReactNode;
  status?: (data: Rec) => string | undefined;
  /** The record actions operate on (defaults to the whole response). */
  record?: (data: Rec) => Rec;
  actions?: ActionDef[];
  tabs?: DetailTab[];
};

export type PageDef = {
  title: string;
  subtitle?: string;
  sections: SectionDef[];
  detail?: DetailDef;
  /** Where the detail page links back to. */
  backLabel?: string;
};
