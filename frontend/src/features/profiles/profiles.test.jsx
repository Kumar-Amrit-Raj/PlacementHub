import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import App from '../../app/App.jsx';
import { AuthProvider } from '../auth/AuthContext.jsx';
import { createAuthClient } from '../../lib/api.js';

const response = (body, status = 200) =>
  new Response(JSON.stringify(body), { status });
function setup(role, path, handler) {
  const fetcher = vi.fn(async (url, options) => {
    if (url.endsWith('/auth/refresh'))
      return response({ accessToken: 'test-token' });
    if (url.endsWith('/auth/me'))
      return response({ user: { id: '1', name: 'Test', role } });
    return handler(url.replace('/api/v1', ''), options);
  });
  render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider client={createAuthClient({ fetcher })}>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );
  return userEvent.setup();
}
const company = {
  _id: 'abc',
  companyName: 'Acme',
  approvalStatus: 'pending',
  profileVersion: 3,
};
describe('profiles and company reviews', () => {
  it('creates a student profile with typed numeric and skill fields, then edits only changed fields', async () => {
    const writes = [];
    const actor = setup('student', '/student/profile', async (url, options) => {
      expect(url).toBe('/profiles/student/me');
      if (options.method === 'PATCH') {
        const body = JSON.parse(options.body);
        writes.push(body);
        return response({ profile: body });
      }
      return response({ profile: null });
    });
    await screen.findByText('No profile yet. Add your details to get started.');
    await actor.click(screen.getByRole('button', { name: 'Create profile' }));
    await actor.type(
      screen.getByLabelText('Institution'),
      'Example University',
    );
    await actor.type(screen.getByLabelText('Graduation year'), '2027');
    await actor.type(
      screen.getByLabelText('Skills (comma-separated)'),
      'React, Node',
    );
    await actor.click(screen.getByRole('button', { name: 'Save profile' }));
    await screen.findByText('Profile saved successfully.');
    expect(writes[0]).toEqual({
      institution: 'Example University',
      graduationYear: 2027,
      skills: ['React', 'Node'],
    });
    await actor.click(screen.getByRole('button', { name: 'Edit profile' }));
    await actor.clear(screen.getByLabelText('Graduation year'));
    await actor.click(screen.getByRole('button', { name: 'Save profile' }));
    await waitFor(() => expect(writes[1]).toEqual({ graduationYear: null }));
  });
  it('shows rejection reason and saves company fields without approval metadata', async () => {
    let body;
    const actor = setup(
      'recruiter',
      '/recruiter/profile',
      async (url, options) => {
        if (options.method === 'PATCH') {
          body = JSON.parse(options.body);
          return response({ profile: { ...company, ...body } });
        }
        return response({
          profile: {
            ...company,
            approvalStatus: 'rejected',
            lastReview: { reason: 'Add a website' },
          },
        });
      },
    );
    await screen.findByText('Add a website', { exact: false });
    expect(
      screen.queryByRole('link', { name: 'Company reviews' }),
    ).not.toBeInTheDocument();
    await actor.click(screen.getByRole('button', { name: 'Edit profile' }));
    await actor.type(screen.getByLabelText('Website'), 'https://example.test');
    await actor.click(screen.getByRole('button', { name: 'Save profile' }));
    await screen.findByText('Profile saved successfully.');
    expect(body).toEqual({ website: 'https://example.test' });
    expect(screen.getByText('pending', { exact: true })).toBeVisible();
  });
  it('retains edits after field validation errors and supports cancel', async () => {
    const actor = setup('student', '/student/profile', async (url, options) =>
      options.method === 'PATCH'
        ? response(
            {
              error: 'Invalid request',
              details: [{ field: 'skills', message: 'Skills must be unique' }],
            },
            400,
          )
        : response({ profile: { institution: 'Existing' } }),
    );
    await screen.findByText('Existing');
    await actor.click(screen.getByRole('button', { name: 'Edit profile' }));
    await actor.type(
      screen.getByLabelText('Skills (comma-separated)'),
      'React, React',
    );
    await actor.click(screen.getByRole('button', { name: 'Save profile' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Skills must be unique',
    );
    expect(screen.getByLabelText('Skills (comma-separated)')).toHaveValue(
      'React, React',
    );
    await actor.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByText('Existing')).toBeVisible();
  });
  it.each([
    ['student', '/recruiter/profile'],
    ['recruiter', '/student/profile'],
    ['student', '/admin/companies'],
    ['recruiter', '/admin/companies/abc'],
    ['admin', '/student/profile'],
  ])('blocks %s from %s before requesting data', async (role, path) => {
    const handler = vi.fn();
    setup(role, path, handler);
    expect(
      await screen.findByRole('heading', { name: 'Access restricted' }),
    ).toBeVisible();
    expect(handler).not.toHaveBeenCalled();
  });
  it('retries a failed profile load and shows the empty state', async () => {
    let calls = 0;
    const actor = setup('student', '/student/profile', async () =>
      ++calls === 1
        ? response({ error: 'Unavailable' }, 503)
        : response({ profile: null }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('Unavailable');
    await actor.click(
      screen.getByRole('button', { name: 'Retry loading profile' }),
    );
    expect(
      await screen.findByRole('button', { name: 'Create profile' }),
    ).toBeVisible();
  });
  it('loads another page of pending companies and refreshes to an empty list', async () => {
    let calls = 0;
    const actor = setup('admin', '/admin/companies', async (url) => {
      calls++;
      if (calls === 1)
        return response({ companies: [company], nextCursor: 'cursor' });
      if (calls === 2) {
        expect(url).toContain('after=cursor');
        return response({
          companies: [{ ...company, _id: 'two', companyName: 'Second' }],
          nextCursor: null,
        });
      }
      return response({ companies: [], nextCursor: null });
    });
    await screen.findByText('Acme');
    await actor.click(
      screen.getByRole('button', { name: 'Load more companies' }),
    );
    await screen.findByText('Second');
    await actor.click(screen.getByRole('button', { name: 'Refresh list' }));
    expect(
      await screen.findByText('No companies waiting for review.'),
    ).toBeVisible();
  });
  it.each(['approve', 'reject'])(
    'submits %s with the reviewed version and reloads the decision',
    async (action) => {
      let body;
      let state = company;
      const actor = setup(
        'admin',
        '/admin/companies/abc',
        async (url, options) => {
          if (options.method === 'POST') {
            expect(url).toBe('/admin/companies/abc/' + action);
            body = JSON.parse(options.body);
            state = {
              ...company,
              approvalStatus: action === 'approve' ? 'approved' : 'rejected',
            };
          }
          return response({ company: state });
        },
      );
      await screen.findByRole('heading', { name: 'Acme' });
      if (action === 'reject') {
        await actor.click(
          screen.getByRole('button', { name: 'Reject company' }),
        );
        expect(screen.getByRole('alert')).toHaveTextContent(
          'Enter a rejection reason',
        );
      }
      await actor.type(screen.getByLabelText('Review reason'), 'Review note');
      await actor.click(
        screen.getByRole('button', {
          name: action === 'approve' ? 'Approve company' : 'Reject company',
        }),
      );
      await waitFor(() =>
        expect(body).toEqual({ expectedVersion: 3, reason: 'Review note' }),
      );
      expect(
        await screen.findByText(state.approvalStatus, { exact: true }),
      ).toBeVisible();
      expect(
        screen.queryByRole('button', { name: 'Approve company' }),
      ).not.toBeInTheDocument();
    },
  );
  it('blocks stale decision retries until company details are reloaded', async () => {
    let reads = 0;
    const actor = setup(
      'admin',
      '/admin/companies/abc',
      async (url, options) => {
        if (options.method === 'POST')
          return response({ error: 'Company changed during review.' }, 409);
        return response({ company: { ...company, profileVersion: ++reads } });
      },
    );
    await screen.findByRole('heading', { name: 'Acme' });
    await actor.click(screen.getByRole('button', { name: 'Approve company' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Reload company details',
    );
    expect(
      screen.getByRole('button', { name: 'Approve company' }),
    ).toBeDisabled();
    await actor.click(
      screen.getByRole('button', { name: 'Reload company details' }),
    );
    await screen.findByText('Profile version 2');
    expect(
      screen.getByRole('button', { name: 'Approve company' }),
    ).toBeEnabled();
  });
});

it('disables approval for an unnamed company and reports missing company details', async () => {
  setup('admin', '/admin/companies/abc', async () =>
    response({ company: { ...company, companyName: '' } }),
  );
  await screen.findByRole('heading', { name: 'Unnamed company' });
  expect(
    screen.getByRole('button', { name: 'Approve company' }),
  ).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Reject company' })).toBeEnabled();
});
it('shows a retryable admin detail error without decision controls', async () => {
  const actor = setup('admin', '/admin/companies/abc', async () =>
    response({ error: 'Company profile not found' }, 404),
  );
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Company profile not found',
  );
  expect(
    screen.queryByRole('button', { name: 'Approve company' }),
  ).not.toBeInTheDocument();
  await actor.click(
    screen.getByRole('button', { name: 'Reload company details' }),
  );
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Company profile not found',
  );
});
