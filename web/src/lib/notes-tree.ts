/** AVORA-100 · S.3 (b): each level 10 px from a 4 px root (was 16 px a level) — long names stay readable. */
export const TREE_ROOT_PX = 4;
export const TREE_STEP_PX = 10;
export function treeIndent(depth: number): number {
  return TREE_ROOT_PX + depth * TREE_STEP_PX;
}
