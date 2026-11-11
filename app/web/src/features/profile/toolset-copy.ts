import {
  AppWindow, BookOpen, Brain, CalendarClock, Code, Eye, Folder, Globe, Image, ListTodo, type LucideIcon, MousePointerClick, Puzzle, Search,
  SquareTerminal, Users, Volume2
} from 'lucide-react'

interface ToolsetCopy {
  readonly label: string
  readonly description: string
}

/**
 * Crew's words for the Hermes toolsets it offers as skills, in the server's order. Hermes's own
 * descriptions are tool lists ("web_search, web_extract"); a toolset that is not here (a plugin's)
 * keeps the label and description Hermes sends.
 */
export const TOOLSET_COPY: Readonly<Record<string, ToolsetCopy>> = {
  web: { label: 'Web search', description: 'Search the web and read pages.' },
  browser: { label: 'Browser', description: 'Open and use a web browser.' },
  terminal: { label: 'Terminal', description: 'Run commands and background processes.' },
  file: { label: 'Files', description: 'Read, write and search files.' },
  code_execution: { label: 'Code', description: 'Run code snippets.' },
  vision: { label: 'Vision', description: 'Look at images.' },
  image_gen: { label: 'Image generation', description: 'Create images.' },
  tts: { label: 'Speech', description: 'Turn text into speech.' },
  skills: { label: 'Skill documents', description: 'Use and manage Hermes skill documents.' },
  todo: { label: 'Task planning', description: 'Keep a to-do list while working.' },
  memory: { label: 'Memory', description: 'Remember things between chats.' },
  session_search: { label: 'Chat search', description: 'Search past chats.' },
  delegation: { label: 'Helpers', description: 'Hand parts of a task to helper agents.' },
  cronjob: { label: 'Scheduling', description: 'Create its own routines. Yours stay as they are.' },
  computer_use: { label: 'Screen control', description: 'Click, type and look on its screen.' }
}

const TOOLSET_ICONS: Readonly<Record<string, LucideIcon>> = {
  web: Globe, browser: AppWindow, terminal: SquareTerminal, file: Folder, code_execution: Code, vision: Eye, image_gen: Image, tts: Volume2,
  skills: BookOpen, todo: ListTodo, memory: Brain, session_search: Search, delegation: Users, cronjob: CalendarClock, computer_use: MousePointerClick
}

/** The words a toolset row shows: Crew's when it has them, else Hermes's, else the bare name. */
export function toolsetCopy(view: { name: string; label: string; description: string }): ToolsetCopy {
  return TOOLSET_COPY[view.name] ?? { label: view.label || view.name, description: view.description }
}

export const toolsetIcon = (name: string): LucideIcon => TOOLSET_ICONS[name] ?? Puzzle
