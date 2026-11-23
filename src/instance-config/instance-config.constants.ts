/** One document per deployment database. */
export const INSTANCE_CONFIG_ID = 'singleton';

/** Bump when the stored shape changes in a way readers must handle. */
export const INSTANCE_CONFIG_SCHEMA_VERSION = 1;

/** One NCERT vector subject: the `subjectId` stored on chunks in the Weaviate collection. */
export interface VectorSubjectMapping {
  key: string;
  label: string;
  vectorSubjectId: string;
}

export interface VectorSearchSettings {
  collectionName: string;
  subjects: VectorSubjectMapping[];
}

/**
 * Used when instance_configs has no `vectorSearch` group. Subjects point at one
 * of these keys through `Subject.vectorSubjectKey`.
 */
export const DEFAULT_VECTOR_SEARCH: VectorSearchSettings = Object.freeze({
  collectionName: 'Ncert',
  subjects: Object.freeze([
    {
      key: 'maths',
      label: 'Maths',
      vectorSubjectId: '6afebebe1ab5de8d66125f86',
    },
    {
      key: 'biology',
      label: 'Biology',
      vectorSubjectId: '6afd6aa47d65768788984fef',
    },
    {
      key: 'chemistry',
      label: 'Chemistry',
      vectorSubjectId: '6afd6aa47d65768788984fee',
    },
    {
      key: 'physics',
      label: 'Physics',
      vectorSubjectId: '6afd6aa47d65768788984fed',
    },
  ]) as VectorSubjectMapping[],
}) as VectorSearchSettings;

/** Frozen operations and redis overrides, loaded once per process. */
export const INSTANCE_RUNTIME_SNAPSHOT = Symbol('INSTANCE_RUNTIME_SNAPSHOT');
