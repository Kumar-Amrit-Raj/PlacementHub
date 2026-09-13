import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { authorize } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { StudentProfile } from './student-profile.model.js';
import { RecruiterProfile } from './recruiter-profile.model.js';
import {
  studentProfilePatch,
  recruiterProfilePatch,
} from './profile.validation.js';
import { updateOwnProfile } from './profile.service.js';

export function createProfileRouter(tokens) {
  const router = Router();
  router.use(authenticate(tokens));
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  for (const [role, Model, schema] of [
    ['student', StudentProfile, studentProfilePatch],
    ['recruiter', RecruiterProfile, recruiterProfilePatch],
  ]) {
    router.get('/' + role + '/me', authorize(role), async (req, res) => {
      res.json({ profile: await Model.findOne({ user: req.user.id }) });
    });
    router.patch(
      '/' + role + '/me',
      authorize(role),
      validate(schema),
      async (req, res) => {
        res.json({
          profile: await updateOwnProfile(Model, req.user.id, req.body),
        });
      },
    );
  }
  return router;
}
