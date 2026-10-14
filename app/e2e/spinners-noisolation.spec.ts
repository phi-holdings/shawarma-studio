// The same songs without site isolation (as Safari): the runtime shares the app's thread, so only the
// pre-flight and the in-runtime guards keep the app responsive. Headless, muted.
import { test } from '@playwright/test';
import { spinnerTests } from './spinners.shared';

test.use({ launchOptions: { args: ['--mute-audio', '--autoplay-policy=document-user-activation-required'] } });

spinnerTests(false);
