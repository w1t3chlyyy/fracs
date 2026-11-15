import type { GeneratorData } from './types';

let generator: Promise<GeneratorData> | null = null;

export const gisApi = {
  /** Справочники для генератора ссылок: страны, города, рубрики, районы (статический файл). */
  generator: () =>
    (generator ??= fetch('/2gis/generator.json').then((r) => {
      if (!r.ok) throw new Error('generator');
      return r.json() as Promise<GeneratorData>;
    }).catch((e) => { generator = null; throw e; })),
};
