export function acquireReturnSubmissionLock(submitLockRef, createdReturn) {
  if (!submitLockRef || submitLockRef.current || createdReturn?.id) return false;
  submitLockRef.current = true;
  return true;
}

export function releaseReturnSubmissionLock(submitLockRef) {
  if (submitLockRef) submitLockRef.current = false;
}
