/**
 * Discriminator for pathway recommendation offerings.
 * COURSE is used today; INSTITUTION is reserved for future college targets
 * that nest under a COURSE via `parentOffering`.
 */
export enum RecommendationKind {
  COURSE = 'COURSE',
  INSTITUTION = 'INSTITUTION',
}
