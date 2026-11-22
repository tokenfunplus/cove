// SPDX-License-Identifier: GPL-3.0-or-later
// Cove's private stdin/stdout adapter for the pinned sherpa-onnx C API.
// Text stays in the pipe; no text or audio is written to diagnostics.
#include "c-api.h"
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <iostream>
#include <map>
#include <string>
#include <vector>
#ifdef COVE_KITTEN_V8
#include <codecvt>
#include <locale>
#include "espeak-ng/speak_lib.h"
#endif

static void put32(std::vector<char>& out, uint32_t value) {
  for (int i = 0; i < 4; ++i) out.push_back(static_cast<char>(value >> (8 * i)));
}
static void put16(std::vector<char>& out, uint16_t value) {
  out.push_back(static_cast<char>(value)); out.push_back(static_cast<char>(value >> 8));
}
static bool read32(uint32_t& value) {
  unsigned char bytes[4];
  if (!std::cin.read(reinterpret_cast<char*>(bytes), 4)) return false;
  value = uint32_t(bytes[0]) | uint32_t(bytes[1]) << 8 | uint32_t(bytes[2]) << 16 | uint32_t(bytes[3]) << 24;
  return true;
}
int main(int argc, char** argv) {
  try {
    std::map<std::string, std::string> options;
    for (int i = 1; i + 1 < argc; i += 2) options[argv[i]] = argv[i + 1];
    auto arg = [&](const char* name) { return options[name].c_str(); };
    SherpaOnnxOfflineTtsConfig config{};
    config.model.num_threads = std::stoi(options["threads"]);
    config.model.provider = "cpu";
    config.max_num_sentences = 1;
    config.silence_scale = 0.2f;
    config.rule_fsts = arg("rules");
    const auto engine = options["engine"];
    if (engine == "kokoro") {
      auto& m = config.model.kokoro;
      m.model = arg("model"); m.voices = arg("voices"); m.tokens = arg("tokens");
      m.data_dir = arg("data"); m.dict_dir = arg("dict"); m.lexicon = arg("lexicon");
      m.length_scale = 1.0f;
    } else if (engine == "kitten") {
      auto& m = config.model.kitten;
      m.model = arg("model"); m.voices = arg("voices"); m.tokens = arg("tokens");
      m.data_dir = arg("data"); m.length_scale = 1.0f;
    } else if (engine == "melo") {
      auto& m = config.model.vits;
      m.model = arg("model"); m.tokens = arg("tokens"); m.lexicon = arg("lexicon");
      m.dict_dir = arg("dict"); m.noise_scale = std::stof(options["noise"]);
      m.noise_scale_w = 0.8f; m.length_scale = 1.0f;
    } else return 2;
    const auto* tts = SherpaOnnxCreateOfflineTts(&config);
    if (!tts) return 3;
#ifdef COVE_KITTEN_V8
    if (espeak_Initialize(AUDIO_OUTPUT_SYNCHRONOUS, 0, ".", 0) < 0 || espeak_SetVoiceByName("en-us") != EE_OK) {
      SherpaOnnxDestroyOfflineTts(tts); return 7;
    }
#endif
    SherpaOnnxGenerationConfig generation{};
    generation.sid = std::stoi(options["voice"]);
    generation.speed = std::stof(options["speed"]);
    generation.silence_scale = 0.2f;
    uint32_t length;
    while (read32(length)) {
      if (!length || length > 8192) { SherpaOnnxDestroyOfflineTts(tts); return 4; }
      std::string text(length, '\0');
      if (!std::cin.read(text.data(), length)) { SherpaOnnxDestroyOfflineTts(tts); return 4; }
#ifdef COVE_KITTEN_V8
      const void* cursor = text.c_str();
      std::string phonemes;
      while (cursor) {
        const auto* value = espeak_TextToPhonemes(&cursor, espeakCHARS_UTF8, espeakPHONEMES_IPA);
        if (value) { if (!phonemes.empty()) phonemes += " "; phonemes += value; }
      }
      std::wstring_convert<std::codecvt_utf8<char32_t>, char32_t> conversion;
      const auto codepoints = conversion.from_bytes(phonemes);
      const int32_t phoneme_length = codepoints.size();
      generation.phoneme_codepoints = reinterpret_cast<const int32_t*>(codepoints.data());
      generation.phoneme_codepoints_lens = &phoneme_length;
      generation.phoneme_codepoints_num_sentences = 1;
#endif
      const auto* audio = SherpaOnnxOfflineTtsGenerateWithConfig(tts, text.c_str(), &generation, nullptr, nullptr);
      if (!audio || audio->n <= 0 || audio->n > 24000 * 120) {
        if (audio) SherpaOnnxDestroyOfflineTtsGeneratedAudio(audio);
        SherpaOnnxDestroyOfflineTts(tts); return 5;
      }
      std::vector<char> wav;
      const uint32_t data_size = audio->n * 2;
      wav.insert(wav.end(), {'R','I','F','F'}); put32(wav, 36 + data_size);
      wav.insert(wav.end(), {'W','A','V','E','f','m','t',' '}); put32(wav, 16);
      put16(wav, 1); put16(wav, 1); put32(wav, audio->sample_rate);
      put32(wav, audio->sample_rate * 2); put16(wav, 2); put16(wav, 16);
      wav.insert(wav.end(), {'d','a','t','a'}); put32(wav, data_size);
      for (int32_t i = 0; i < audio->n; ++i) {
        const auto value = std::isfinite(audio->samples[i]) ? std::clamp(audio->samples[i], -1.0f, 1.0f) : 0.0f;
        put16(wav, static_cast<uint16_t>(static_cast<int16_t>(value * 32767.0f)));
      }
      std::vector<char> prefix; put32(prefix, wav.size());
      std::cout.write(prefix.data(), prefix.size()); std::cout.write(wav.data(), wav.size()); std::cout.flush();
      SherpaOnnxDestroyOfflineTtsGeneratedAudio(audio);
      if (!std::cout) break;
    }
    SherpaOnnxDestroyOfflineTts(tts);
    return 0;
  } catch (...) { return 6; }
}
