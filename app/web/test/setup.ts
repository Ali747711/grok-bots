import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

import { clearDrafts } from '@/features/chat/draft-store'

afterEach(() => {
  cleanup()
  // Drafts live for the life of the tab; a test file is one tab, so each test starts with none.
  clearDrafts()
})
