export const fields = {
  student: [
    ['institution', 'Institution', 'text', 200],
    ['degree', 'Degree', 'text', 100],
    ['branch', 'Branch', 'text', 100],
    ['graduationYear', 'Graduation year', 'number', 1950, 2100],
    ['cgpa', 'CGPA', 'number', 0, 10],
    ['skills', 'Skills (comma-separated)', 'skills'],
    ['bio', 'Bio', 'textarea', 2000],
    ['location', 'Location', 'text', 200],
    ['phone', 'Phone', 'tel', 30],
    ['portfolioUrl', 'Portfolio URL', 'url', 2048],
    ['linkedinUrl', 'LinkedIn URL', 'url', 2048],
    ['githubUrl', 'GitHub URL', 'url', 2048],
  ],
  recruiter: [
    ['companyName', 'Company name', 'text', 200],
    ['website', 'Website', 'url', 2048],
    ['industry', 'Industry', 'text', 100],
    ['companySize', 'Company size', 'select'],
    ['description', 'Company description', 'textarea', 4000],
    ['headquarters', 'Headquarters', 'text', 200],
    ['recruiterTitle', 'Your job title', 'text', 100],
    ['phone', 'Phone', 'tel', 30],
    ['contactEmail', 'Contact email', 'email', 254],
  ],
};
export const companySizes = [
  '1-10',
  '11-50',
  '51-200',
  '201-500',
  '501-1000',
  '1001+',
];
export function formValues(role, profile) {
  return Object.fromEntries(
    fields[role].map(([key, , type]) => [
      key,
      type === 'skills'
        ? (profile?.[key] ?? []).join(', ')
        : String(profile?.[key] ?? ''),
    ]),
  );
}
export function profilePatch(role, draft, profile) {
  const initial = formValues(role, profile);
  return Object.fromEntries(
    fields[role]
      .filter(([key]) => draft[key] !== initial[key])
      .map(([key, , type]) => [
        key,
        type === 'number'
          ? draft[key] === ''
            ? null
            : Number(draft[key])
          : type === 'select'
            ? draft[key] || null
            : type === 'skills'
              ? draft[key]
                  .split(',')
                  .map((value) => value.trim())
                  .filter(Boolean)
              : draft[key].trim(),
      ]),
  );
}
