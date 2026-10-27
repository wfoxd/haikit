import type { Greeting } from "../shared/surfaces.ts";

export const GREETINGS: Greeting[] = [
  { code: "en", language: "English",  text: "Hello, World!",        script: "Latin",    rtl: false, speakersM: 1500 },
  { code: "zh", language: "Mandarin", text: "你好，世界！",          script: "Han",      rtl: false, speakersM: 1100 },
  { code: "es", language: "Spanish",  text: "¡Hola, mundo!",        script: "Latin",    rtl: false, speakersM: 560 },
  { code: "ar", language: "Arabic",   text: "مرحبا بالعالم!",       script: "Arabic",   rtl: true,  speakersM: 420 },
  { code: "ja", language: "Japanese", text: "こんにちは世界！",      script: "Japanese", rtl: false, speakersM: 125 },
  { code: "he", language: "Hebrew",   text: "שלום, עולם!",          script: "Hebrew",   rtl: true,  speakersM: 9 },
];