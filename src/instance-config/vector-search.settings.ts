import {
  DEFAULT_VECTOR_SEARCH,
  VectorSearchSettings,
} from './instance-config.constants';
import { InstanceVectorSearchConfig } from './schemas/instance-config.schema';

export interface ResolvedVectorSearch extends VectorSearchSettings {
  isDefault: boolean;
}

/** Stored values win field by field; anything missing falls back to code defaults. */
export function resolveVectorSearch(
  stored?: InstanceVectorSearchConfig | null,
): ResolvedVectorSearch {
  const collectionName =
    stored?.collectionName?.trim() || DEFAULT_VECTOR_SEARCH.collectionName;
  const storedSubjects = stored?.subjects?.length ? stored.subjects : null;
  const subjects = (storedSubjects ?? DEFAULT_VECTOR_SEARCH.subjects).map(
    s => ({ key: s.key, label: s.label, vectorSubjectId: s.vectorSubjectId }),
  );
  return {
    collectionName,
    subjects,
    isDefault: !stored?.collectionName?.trim() && !storedSubjects,
  };
}
