import { create } from "zustand";
import { persist } from "zustand/middleware";
import i18n, { type LanguageChoice } from "../i18n";

export type ThemeChoice = "system" | "light" | "dark";
export type DesignDirection = "a" | "b" | "c";
export type MotionPreference = "system" | "reduced";
export type ReaderTextSize = "small" | "comfortable" | "large";
export type ReaderWidth = "narrow" | "comfortable" | "wide";
export type LibrarySort = "recent" | "title" | "oldest";
export type LibraryView = "grid" | "list";

interface UiState {
  theme: ThemeChoice;
  language: LanguageChoice;
  direction: DesignDirection;
  motionPreference: MotionPreference;
  readerTextSize: ReaderTextSize;
  readerWidth: ReaderWidth;
  favoriteNoteIds: string[];
  librarySort: LibrarySort;
  libraryView: LibraryView;
  setLibrarySort: (sort: LibrarySort) => void;
  setLibraryView: (view: LibraryView) => void;
  setTheme: (theme: ThemeChoice) => void;
  setLanguage: (language: LanguageChoice) => void;
  setDirection: (direction: DesignDirection) => void;
  setMotionPreference: (preference: MotionPreference) => void;
  setReaderTextSize: (size: ReaderTextSize) => void;
  setReaderWidth: (width: ReaderWidth) => void;
  toggleFavoriteNote: (noteId: string) => void;
}

export const useUiStore = create<UiState>()(persist(
  (set) => ({
    theme: "system",
    language: "en",
    direction: "b",
    motionPreference: "system",
    readerTextSize: "comfortable",
    readerWidth: "comfortable",
    favoriteNoteIds: [],
    librarySort: "recent",
    libraryView: "grid",
    setLibrarySort: (librarySort) => set({ librarySort }),
    setLibraryView: (libraryView) => set({ libraryView }),
    setTheme: (theme) => set({ theme }),
    setLanguage: (language) => {
      set({ language });
      void i18n.changeLanguage(language);
    },
    setDirection: (direction) => set({ direction }),
    setMotionPreference: (motionPreference) => set({ motionPreference }),
    setReaderTextSize: (readerTextSize) => set({ readerTextSize }),
    setReaderWidth: (readerWidth) => set({ readerWidth }),
    toggleFavoriteNote: (noteId) => set((state) => ({
      favoriteNoteIds: state.favoriteNoteIds.includes(noteId)
        ? state.favoriteNoteIds.filter((id) => id !== noteId)
        : [...state.favoriteNoteIds, noteId],
    })),
  }),
  {
    name: "notez-ui-preferences",
    partialize: ({ theme, language, direction, motionPreference, readerTextSize, readerWidth, favoriteNoteIds, librarySort, libraryView }) => ({
      librarySort,
      libraryView,
      theme,
      language,
      direction,
      motionPreference,
      readerTextSize,
      readerWidth,
      favoriteNoteIds,
    }),
  },
));
