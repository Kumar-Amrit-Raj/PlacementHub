import { it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import App from '../../app/App.jsx';
import { AuthProvider } from '../auth/AuthContext.jsx';
import { createAuthClient } from '../../lib/api.js';
const item = {
  _id: 'job',
  title: 'Engineer',
  company: { companyName: 'Example Labs' },
  deadline: '2099-01-01T00:00:00Z',
  eligibility: { status: 'eligible', reasons: [] },
  description: 'Build software',
  allowedBranches: [],
};
const application = {
  _id: 'app',
  opportunity: 'job',
  status: 'applied',
  version: 0,
  createdAt: '2026-01-01T00:00:00Z',
  snapshot: {
    title: 'Engineer',
    companyName: 'Example Labs',
    studentName: 'Asha',
    studentEmail: 'asha@example.test',
    profile: { cgpa: 8, branch: 'CSE', graduationYear: 2027 },
  },
  history: [{ from: null, to: 'applied', at: '2026-01-01T00:00:00Z' }],
};
const response = (body, status = 200) =>
  new Response(JSON.stringify(body), { status });
function setup(role, path, handler) {
  const fetcher = vi.fn(async (url, options) => {
    if (url.endsWith('/auth/refresh'))
      return response({ accessToken: 'fixture' });
    if (url.endsWith('/auth/me'))
      return response({ user: { id: 'u', name: 'Asha', role } });
    return handler(url.replace('/api/v1', ''), options);
  });
  render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider client={createAuthClient({ fetcher })}>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );
  return { actor: userEvent.setup(), fetcher };
}
it('checks all application pages, submits once and shows success', async () => {
  let posts = 0;
  const urls = [];
  const { actor } = setup(
    'student',
    '/student/opportunities/job',
    async (url, options) => {
      urls.push(url);
      if (url === '/opportunities/job') return response({ opportunity: item });
      if (options.method === 'POST') {
        posts++;
        expect(JSON.parse(options.body)).toEqual({ opportunityId: 'job' });
        return response({ application }, 201);
      }
      return response({
        applications: [],
        nextCursor: url.includes('after=') ? null : 'next',
      });
    },
  );
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Apply', exact: true }),
    ).toBeEnabled(),
  );
  expect(urls.some((url) => url.includes('after=next'))).toBe(true);
  await actor.dblClick(
    screen.getByRole('button', { name: 'Apply', exact: true }),
  );
  await screen.findByText('Application submitted successfully.');
  expect(posts).toBe(1);
  expect(
    screen.getByRole('button', { name: 'Already applied' }),
  ).toBeDisabled();
});
it('blocks an already applied opportunity found beyond the first page', async () => {
  setup('student', '/student/opportunities/job', (url) =>
    response(
      url === '/opportunities/job'
        ? { opportunity: item }
        : url.includes('after=')
          ? { applications: [application], nextCursor: null }
          : { applications: [], nextCursor: 'next' },
    ),
  );
  expect(
    await screen.findByRole('button', { name: 'Already applied' }),
  ).toBeDisabled();
});
it.each(['not_eligible', 'incomplete_profile'])(
  'blocks applying for %s',
  async (status) => {
    setup('student', '/student/opportunities/job', (url) =>
      response(
        url === '/opportunities/job'
          ? { opportunity: { ...item, eligibility: { status, reasons: [] } } }
          : { applications: [], nextCursor: null },
      ),
    );
    await screen.findByText(
      'Meet the eligibility requirements and complete the required profile fields before applying.',
    );
    expect(
      screen.getByRole('button', { name: 'Apply', exact: true }),
    ).toBeDisabled();
  },
);
it.each([404, 422, 503])(
  'shows submission %s feedback and blocks immediate retry',
  async (status) => {
    const { actor } = setup(
      'student',
      '/student/opportunities/job',
      (url, options) =>
        options.method === 'POST'
          ? response({ error: 'Submission unavailable' }, status)
          : response(
              url === '/opportunities/job'
                ? { opportunity: item }
                : { applications: [], nextCursor: null },
            ),
    );
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Apply', exact: true }),
      ).toBeEnabled(),
    );
    await actor.click(
      screen.getByRole('button', { name: 'Apply', exact: true }),
    );
    expect(await screen.findByRole('alert')).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Apply', exact: true }),
    ).toBeDisabled();
  },
);
it('handles duplicate response as already applied', async () => {
  const { actor } = setup(
    'student',
    '/student/opportunities/job',
    (url, options) =>
      options.method === 'POST'
        ? response({ error: 'Duplicate' }, 409)
        : response(
            url === '/opportunities/job'
              ? { opportunity: item }
              : { applications: [], nextCursor: null },
          ),
  );
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Apply', exact: true }),
    ).toBeEnabled(),
  );
  await actor.click(screen.getByRole('button', { name: 'Apply', exact: true }));
  expect(
    await screen.findByRole('button', { name: 'Already applied' }),
  ).toBeDisabled();
});
it('shows student application snapshot, status and history with pagination', async () => {
  const { actor } = setup('student', '/student/applications', (url) =>
    response({
      applications: [
        {
          ...application,
          _id: url.includes('after=') ? 'two' : 'app',
          snapshot: {
            ...application.snapshot,
            title: url.includes('after=') ? 'Second role' : 'Engineer',
          },
        },
      ],
      nextCursor: url.includes('after=') ? null : 'app',
    }),
  );
  await screen.findByText('Engineer');
  await actor.click(screen.getByText('Status history'));
  expect(screen.getAllByText('applied', { exact: true }).length).toBe(2);
  expect(
    screen.queryByRole('button', { name: 'Shortlist' }),
  ).not.toBeInTheDocument();
  await actor.click(
    screen.getByRole('button', { name: 'Load more applications' }),
  );
  await screen.findByText('Second role');
});
it('sends expectedVersion and shows only the next legal controls', async () => {
  const { actor } = setup(
    'recruiter',
    '/recruiter/applications?opportunityId=job',
    (url, options) => {
      if (options.method === 'PATCH') {
        expect(JSON.parse(options.body)).toEqual({
          status: 'shortlisted',
          expectedVersion: 0,
        });
        return response({
          application: { ...application, status: 'shortlisted', version: 1 },
        });
      }
      expect(url).toContain('opportunityId=job');
      return response({ applications: [application], nextCursor: null });
    },
  );
  await screen.findByText('Asha');
  expect(screen.getByText('asha@example.test')).toBeVisible();
  expect(
    screen.queryByRole('button', { name: 'Select applicant' }),
  ).not.toBeInTheDocument();
  await actor.click(screen.getByRole('button', { name: 'Shortlist' }));
  await screen.findByRole('button', { name: 'Move to interview' });
  expect(
    screen.queryByRole('button', { name: 'Shortlist' }),
  ).not.toBeInTheDocument();
});
it('requires reload after a stale status update and uses the fresh version', async () => {
  let reads = 0,
    posts = 0;
  const { actor } = setup(
    'recruiter',
    '/recruiter/applications',
    (url, options) => {
      if (options.method === 'PATCH') {
        posts++;
        if (posts === 1) return response({ error: 'Stale' }, 409);
        expect(JSON.parse(options.body)).toEqual({
          status: 'interview',
          expectedVersion: 1,
        });
        return response({
          application: { ...application, status: 'interview', version: 2 },
        });
      }
      reads++;
      return response({
        applications: [
          reads === 1
            ? application
            : { ...application, status: 'shortlisted', version: 1 },
        ],
        nextCursor: null,
      });
    },
  );
  await screen.findByRole('button', { name: 'Shortlist' });
  await actor.click(screen.getByRole('button', { name: 'Shortlist' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Refresh applications',
  );
  expect(screen.getByRole('button', { name: 'Shortlist' })).toBeDisabled();
  await actor.click(
    screen.getByRole('button', { name: 'Refresh applications' }),
  );
  await screen.findByRole('button', { name: 'Move to interview' });
  await actor.click(screen.getByRole('button', { name: 'Move to interview' }));
  await screen.findByRole('button', { name: 'Select applicant' });
});
it.each(['selected', 'rejected'])(
  'has no update controls for terminal %s',
  async (status) => {
    setup('recruiter', '/recruiter/applications', () =>
      response({
        applications: [{ ...application, status }],
        nextCursor: null,
      }),
    );
    await screen.findByText('This application has reached a final status.');
    expect(
      screen.queryByRole('button', { name: 'Reject applicant' }),
    ).not.toBeInTheDocument();
  },
);
it('retries a failed application list and shows an empty state', async () => {
  let count = 0;
  const { actor } = setup('student', '/student/applications', () =>
    ++count === 1
      ? response({ error: 'Unavailable' }, 503)
      : response({ applications: [], nextCursor: null }),
  );
  await screen.findByRole('alert');
  await actor.click(
    screen.getByRole('button', { name: 'Refresh applications' }),
  );
  await screen.findByText('No applications yet');
});
it.each([
  ['student', '/recruiter/applications'],
  ['recruiter', '/student/applications'],
  ['admin', '/recruiter/applications'],
])('denies %s access to %s', async (role, path) => {
  const handler = vi.fn();
  setup(role, path, handler);
  await screen.findByRole('heading', { name: 'Access restricted' });
  expect(handler).not.toHaveBeenCalled();
});

it('refreshes opportunity eligibility as well as duplicates before retrying after 422', async () => {
  let reads = 0;
  const { actor } = setup(
    'student',
    '/student/opportunities/job',
    (url, options) => {
      if (options.method === 'POST')
        return response(
          {
            error: 'Eligibility changed',
            eligibility: {
              status: 'not_eligible',
              reasons: [{ field: 'cgpa', message: 'Minimum CGPA is 7.' }],
            },
          },
          422,
        );
      if (url === '/opportunities/job') {
        reads++;
        return response({
          opportunity:
            reads === 1
              ? item
              : {
                  ...item,
                  eligibility: { status: 'not_eligible', reasons: [] },
                },
        });
      }
      return response({ applications: [], nextCursor: null });
    },
  );
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Apply', exact: true }),
    ).toBeEnabled(),
  );
  await actor.click(screen.getByRole('button', { name: 'Apply', exact: true }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Minimum CGPA is 7.',
  );
  await actor.click(
    screen.getByRole('button', {
      name: 'Refresh opportunity and application status',
    }),
  );
  await screen.findByText(
    'Meet the eligibility requirements and complete the required profile fields before applying.',
  );
  expect(reads).toBe(2);
  expect(
    screen.getByRole('button', { name: 'Apply', exact: true }),
  ).toBeDisabled();
});
it('finds a committed application after an uncertain submission without reposting', async () => {
  let posted = false,
    posts = 0;
  const { actor } = setup(
    'student',
    '/student/opportunities/job',
    (url, options) => {
      if (options.method === 'POST') {
        posted = true;
        posts++;
        throw Error('Network interrupted');
      }
      return response(
        url === '/opportunities/job'
          ? { opportunity: item }
          : { applications: posted ? [application] : [], nextCursor: null },
      );
    },
  );
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Apply', exact: true }),
    ).toBeEnabled(),
  );
  await actor.click(screen.getByRole('button', { name: 'Apply', exact: true }));
  await screen.findByRole('alert');
  await actor.click(
    screen.getByRole('button', {
      name: 'Refresh opportunity and application status',
    }),
  );
  expect(
    await screen.findByRole('button', { name: 'Already applied' }),
  ).toBeDisabled();
  expect(posts).toBe(1);
});
it('does not overwrite freshly loaded recruiter data with an old in-flight response', async () => {
  let resolveUpdate,
    reads = 0;
  const { actor } = setup(
    'recruiter',
    '/recruiter/applications',
    (url, options) => {
      if (options.method === 'PATCH')
        return new Promise((resolve) => {
          resolveUpdate = resolve;
        });
      reads++;
      return response({
        applications: [
          reads === 1
            ? application
            : { ...application, status: 'selected', version: 3 },
        ],
        nextCursor: null,
      });
    },
  );
  await screen.findByRole('button', { name: 'Shortlist' });
  await actor.click(screen.getByRole('button', { name: 'Shortlist' }));
  await actor.click(
    screen.getByRole('button', { name: 'Refresh applications' }),
  );
  await screen.findByText('This application has reached a final status.');
  resolveUpdate(
    response({
      application: { ...application, status: 'shortlisted', version: 1 },
    }),
  );
  await waitFor(() =>
    expect(
      screen.queryByRole('button', { name: 'Move to interview' }),
    ).not.toBeInTheDocument(),
  );
  expect(screen.getByText('selected', { exact: true })).toBeVisible();
});
it('recovers a failed next page without losing existing student applications', async () => {
  let attempts = 0;
  const { actor } = setup('student', '/student/applications', (url) => {
    if (url.includes('after=')) {
      attempts++;
      return attempts === 1
        ? response({ error: 'Temporary failure' }, 503)
        : response({
            applications: [
              {
                ...application,
                _id: 'two',
                snapshot: { ...application.snapshot, title: 'Second' },
              },
            ],
            nextCursor: null,
          });
    }
    return response({ applications: [application], nextCursor: 'app' });
  });
  await screen.findByText('Engineer');
  await actor.click(
    screen.getByRole('button', { name: 'Load more applications' }),
  );
  await screen.findByRole('alert');
  expect(screen.getByText('Engineer')).toBeVisible();
  await actor.click(
    screen.getByRole('button', { name: 'Load more applications' }),
  );
  await screen.findByText('Second');
});
