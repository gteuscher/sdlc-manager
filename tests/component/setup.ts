/**
 * Component-test setup: React Testing Library plus the accessibility matchers.
 *
 * `vitest-axe` is what turns Principle XI's gate 6 from a claim into an
 * assertion. The constitution is explicit that this covers only the subset a
 * machine can verify — manual screen-reader certification is out of scope for a
 * single maintainer and is not claimed anywhere.
 */

import { afterEach, expect } from 'vitest';
import { cleanup } from '@testing-library/react';
import * as matchers from 'vitest-axe/matchers';

expect.extend(matchers);

afterEach(() => {
  cleanup();
});
