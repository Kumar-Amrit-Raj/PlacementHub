export const jobTypes = ['full-time', 'part-time', 'internship', 'contract'];
export function localDeadline(value) {
  if (!value) return '';
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}
export function draftValues(item = {}) {
  return {
    title: item.title ?? '',
    description: item.description ?? '',
    jobType: item.jobType ?? 'full-time',
    location: item.location ?? '',
    compensation: item.compensation ?? '',
    deadline: localDeadline(item.deadline),
    minimumCgpa: String(item.minimumCgpa ?? ''),
    graduationYear: String(item.graduationYear ?? ''),
    allowedBranches: (item.allowedBranches ?? []).join(', '),
  };
}
export function payload(draft, original) {
  const initial = original ? draftValues(original) : null;
  return Object.fromEntries(
    Object.entries(draft)
      .filter(([key, value]) => !initial || initial[key] !== value)
      .map(([key, value]) => [
        key,
        ['minimumCgpa', 'graduationYear'].includes(key)
          ? value === ''
            ? null
            : Number(value)
          : key === 'deadline'
            ? new Date(value).toISOString()
            : key === 'allowedBranches'
              ? value
                  .split(',')
                  .map((part) => part.trim())
                  .filter(Boolean)
              : value.trim(),
      ]),
  );
}
export function expired(item, now = Date.now()) {
  return new Date(item.deadline).getTime() <= now;
}
export function needsRepublish(item, company) {
  return (
    item.status === 'published' &&
    (!company ||
      company.approvalStatus !== 'approved' ||
      item.approvedCompanyVersion !== (company.profileVersion ?? 0))
  );
}
