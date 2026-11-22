import type { LocalModel } from "./local-model-types";

// Curated discovery metadata. Only entries marked ready have Cove installers.
export const curatedLocalModels = [
  {
    "id": "bge-small-zh",
    "name": "BGE Small Chinese v1.5",
    "publisher": "BAAI",
    "purpose": "search",
    "role": "Tool",
    "benefit": "Find Chinese documents by meaning",
    "example": "Find a passage even when your question uses different words.",
    "limitation": "Produces search vectors; a separate model writes the answer.",
    "languages": [
      "zh"
    ],
    "languageLabel": "Chinese",
    "weightMB": 26.5,
    "format": "GGUF \u00b7 Q8_0",
    "runtime": "llama.cpp",
    "license": "MIT",
    "files": [
      "bge-small-zh-v1.5-q8_0.gguf"
    ],
    "setup": "This GGUF includes tokenizer metadata. Cove installs a pinned, SHA-256-checked conversion from Compendium Labs and runs it locally.",
    "modelUrl": "https://huggingface.co/BAAI/bge-small-zh-v1.5",
    "filesUrl": "https://huggingface.co/CompendiumLabs/bge-small-zh-v1.5-gguf/tree/5bf683e6a1bd454bbb60ba051088c50731d63fcb",
    "source": "Community conversion",
    "availability": "ready",
    "licenseUrl": "https://huggingface.co/BAAI/bge-small-zh-v1.5",
    "revision": "5bf683e6a1bd454bbb60ba051088c50731d63fcb"
  },
  {
    "id": "qwen-small-chat",
    "name": "Qwen2.5 0.5B Instruct",
    "publisher": "Qwen",
    "purpose": "write",
    "role": "Chat model",
    "benefit": "Try lightweight offline writing and chat",
    "example": "Experiment with short rewrites and extracting text from supplied material.",
    "limitation": "Experimental: can invent facts and produce incorrect code. Verify all outputs.",
    "languages": [
      "en",
      "zh"
    ],
    "languageLabel": "Chinese and English",
    "weightMB": 491.4,
    "format": "GGUF \u00b7 Q4_K_M",
    "runtime": "llama.cpp",
    "license": "Apache-2.0",
    "files": [
      "qwen2.5-0.5b-instruct-q4_k_m.gguf"
    ],
    "setup": "Cove installs this pinned GGUF with its tokenizer metadata and bundled runtime. Experimental rewriting and extraction only; review outputs.",
    "modelUrl": "https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF",
    "filesUrl": "https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/tree/9217f5db79a29953eb74d5343926648285ec7e67",
    "source": "Publisher",
    "availability": "ready",
    "licenseUrl": "https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF",
    "revision": "9217f5db79a29953eb74d5343926648285ec7e67"
  },
  {
    "id": "qwen3-abliterated-chat",
    "name": "Qwen3 0.6B Abliterated Q5_K_M",
    "publisher": "mlabonne / Qwen",
    "purpose": "write",
    "role": "Chat model",
    "availability": "ready",
    "benefit": "Try offline chat with reduced refusals",
    "example": "Compare an experimental abliterated Qwen3 with the original Qwen2.5 model.",
    "limitation": "Experimental: reduced refusals do not improve accuracy. Facts and code may be wrong. Verify all outputs.",
    "languages": [
      "en",
      "zh"
    ],
    "languageLabel": "Chinese and English",
    "weightMB": 444.4,
    "format": "GGUF \u00b7 Q5_K_M",
    "runtime": "llama.cpp",
    "license": "Apache-2.0",
    "licenseUrl": "https://huggingface.co/mlabonne/Qwen3-0.6B-abliterated-GGUF",
    "files": [
      "qwen3-0.6b-abliterated.q5_k_m.gguf"
    ],
    "setup": "Cove installs a pinned, SHA-256-checked GGUF and runs its bundled chat template in non-thinking mode. Context is limited to 4,096 tokens and output to 1,024 tokens.",
    "modelUrl": "https://huggingface.co/mlabonne/Qwen3-0.6B-abliterated",
    "filesUrl": "https://huggingface.co/mlabonne/Qwen3-0.6B-abliterated-GGUF/tree/92351f431cfdd36f71149aaf072a6490a68e144e",
    "source": "Publisher",
    "revision": "92351f431cfdd36f71149aaf072a6490a68e144e"
  },
  {
    "id": "rapidocr",
    "name": "PP-OCRv4 Mobile",
    "publisher": "PaddleOCR \u00b7 RapidOCR conversion",
    "purpose": "ocr",
    "role": "Tool",
    "availability": "explore",
    "benefit": "Read Chinese text in screenshots",
    "example": "Extract printed Chinese and English text from images before searching it.",
    "limitation": "Detection and recognition are both needed. Layout, tables, handwriting, and small text need review.",
    "languages": [
      "en",
      "zh"
    ],
    "languageLabel": "Chinese and English",
    "weightMB": 15.6,
    "format": "ONNX \u00b7 detector + recognizer",
    "runtime": "RapidOCR / ONNX Runtime",
    "license": "Apache-2.0",
    "licenseUrl": "https://rapidai.github.io/RapidOCRDocs/main/en/model_licenses/",
    "files": [
      "PP-OCRv4/ch_PP-OCRv4_det_infer.onnx",
      "PP-OCRv4/ch_PP-OCRv4_rec_infer.onnx"
    ],
    "setup": "Size includes both mobile networks. Also needs the recognition dictionary and image preprocessing; orientation classification is optional.",
    "modelUrl": "https://github.com/PaddlePaddle/PaddleOCR",
    "filesUrl": "https://huggingface.co/SWHL/RapidOCR/tree/1cfba2e90fc938db55889873735088de210cc173",
    "source": "Community conversion",
    "revision": "1cfba2e90fc938db55889873735088de210cc173"
  },
  {
    "id": "opus-en-zh",
    "name": "OPUS-MT EN-ZH",
    "publisher": "Helsinki-NLP",
    "purpose": "translate",
    "role": "Tool",
    "availability": "explore",
    "benefit": "Translate English into Chinese",
    "example": "Translate a short English passage locally before working with its Chinese text.",
    "limitation": "Direction-specific translation. Names, terminology, and formatting can be mistranslated.",
    "languages": [
      "en",
      "zh"
    ],
    "languageLabel": "English \u2192 Chinese",
    "weightMB": 113.1,
    "format": "ONNX \u00b7 INT8 encoder + decoder",
    "runtime": "ONNX Runtime",
    "license": "Apache-2.0",
    "licenseUrl": "https://huggingface.co/Helsinki-NLP/opus-mt-en-zh",
    "files": [
      "onnx/encoder_model_quantized.onnx",
      "onnx/decoder_model_merged_quantized.onnx"
    ],
    "setup": "Requires both networks, matching SentencePiece/tokenizer files, and autoregressive decoding. The reverse direction uses a separate model.",
    "modelUrl": "https://huggingface.co/Helsinki-NLP/opus-mt-en-zh",
    "filesUrl": "https://huggingface.co/Xenova/opus-mt-en-zh/tree/046f55aec303cdee3e0318604406d4df20f1e8ea",
    "source": "Community conversion",
    "revision": "046f55aec303cdee3e0318604406d4df20f1e8ea"
  },
  {
    "id": "kokoro-zh",
    "name": "Kokoro 82M v1.1 \u00b7 Chinese",
    "publisher": "hexgrad \u00b7 sherpa-onnx conversion",
    "purpose": "speak",
    "role": "Tool",
    "availability": "ready",
    "benefit": "Read Chinese text aloud",
    "example": "Listen to Mandarin passages and mixed Chinese-English answers.",
    "limitation": "Names, numbers, and mixed-language pronunciation need review.",
    "languages": [
      "zh",
      "en"
    ],
    "languageLabel": "Chinese and English",
    "weightMB": 147.1,
    "format": "ONNX \u00b7 INT8",
    "runtime": "Bundled local speech runtime \u00b7 Apple Silicon",
    "license": "Apache-2.0",
    "licenseUrl": "https://huggingface.co/hexgrad/Kokoro-82M-v1.1-zh",
    "files": [
      "model.int8.onnx",
      "tokens.txt",
      "voices.bin",
      "lexicon-zh.txt",
      "lexicon-us-en.txt",
      "date-zh.fst",
      "number-zh.fst",
      "phone-zh.fst"
    ],
    "setup": "Cove downloads and verifies the complete model, voice, and language files. Choose a voice in On this Mac > Speech. Requires macOS 13.3 or later on Apple Silicon.",
    "modelUrl": "https://huggingface.co/hexgrad/Kokoro-82M-v1.1-zh",
    "filesUrl": "https://github.com/k2-fsa/sherpa-onnx/releases/tag/tts-models",
    "source": "Community conversion",
    "revision": "259c9c8bc906d6078e4e0570421885dabb68b539c2f970fcbb890a58eeaf3e9c"
  },
  {
    "id": "sensevoice",
    "name": "SenseVoice Small",
    "publisher": "FunAudioLLM \u00b7 sherpa-onnx conversion",
    "purpose": "voice",
    "role": "Tool",
    "availability": "explore",
    "benefit": "Transcribe Chinese and multilingual recordings",
    "example": "Turn Mandarin, Cantonese, English, Japanese, or Korean speech into text.",
    "limitation": "Requires audio preprocessing and long-recording segmentation. Uses custom model license terms.",
    "languages": [
      "en",
      "zh",
      "multilingual"
    ],
    "languageLabel": "Chinese, Cantonese, English, Japanese, Korean",
    "weightMB": 239.2,
    "format": "ONNX \u00b7 INT8",
    "runtime": "sherpa-onnx",
    "license": "FunASR Model License",
    "licenseUrl": "https://github.com/modelscope/FunASR/blob/main/MODEL_LICENSE",
    "files": [
      "model.int8.onnx"
    ],
    "setup": "Requires tokens.txt, the matching frontend, and 16 kHz audio processing. Review the model agreement separately from runtime licensing.",
    "modelUrl": "https://huggingface.co/FunAudioLLM/SenseVoiceSmall",
    "filesUrl": "https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/tree/2365baeacb507f821a0c8120fcee3d484dba7a07",
    "source": "Community conversion",
    "revision": "2365baeacb507f821a0c8120fcee3d484dba7a07"
  },
  {
    "id": "mobilenet-vision",
    "name": "MobileNetV4 Conv Small",
    "publisher": "Google \u00b7 timm / ONNX Community",
    "purpose": "vision",
    "role": "Tool",
    "availability": "explore",
    "benefit": "Classify everyday pictures",
    "example": "Assign a picture to one of the predefined ImageNet categories.",
    "limitation": "Classifies an entire image; it cannot describe arbitrary scenes or read text.",
    "languages": [
      "independent"
    ],
    "languageLabel": "Language-independent",
    "weightMB": 3.9,
    "format": "ONNX \u00b7 INT8",
    "runtime": "ONNX Runtime",
    "license": "Apache-2.0",
    "licenseUrl": "https://huggingface.co/timm/mobilenetv4_conv_small.e2400_r224_in1k",
    "files": [
      "onnx/model_quantized.onnx"
    ],
    "setup": "Requires the matching 224-pixel image processor, normalization, and class labels.",
    "modelUrl": "https://huggingface.co/timm/mobilenetv4_conv_small.e2400_r224_in1k",
    "filesUrl": "https://huggingface.co/onnx-community/mobilenetv4_conv_small.e2400_r224_in1k/tree/3ba07f12712fa58fd6b3d661f9909c9e332c5005",
    "source": "Community conversion",
    "revision": "3ba07f12712fa58fd6b3d661f9909c9e332c5005"
  },
  {
    "id": "qwen-coder",
    "name": "Qwen2.5 Coder 0.5B Instruct",
    "publisher": "Qwen",
    "purpose": "code",
    "role": "Chat model",
    "availability": "explore",
    "benefit": "Experiment with a dedicated small coding model",
    "example": "Try short code completions and explanations in a code-focused model.",
    "limitation": "May produce invalid code or incorrect explanations. Run independent checks; it cannot execute code.",
    "languages": [
      "en"
    ],
    "languageLabel": "English \u00b7 code",
    "weightMB": 491.4,
    "format": "GGUF \u00b7 Q4_K_M",
    "runtime": "llama.cpp",
    "license": "Apache-2.0",
    "licenseUrl": "https://huggingface.co/Qwen/Qwen2.5-Coder-0.5B-Instruct-GGUF",
    "files": [
      "qwen2.5-coder-0.5b-instruct-q4_k_m.gguf"
    ],
    "setup": "Requires a compatible chat template and separate runtime integration. It is not a tool runner or replacement for testing.",
    "modelUrl": "https://huggingface.co/Qwen/Qwen2.5-Coder-0.5B-Instruct-GGUF",
    "filesUrl": "https://huggingface.co/Qwen/Qwen2.5-Coder-0.5B-Instruct-GGUF/tree/ebb2015119c907b064c512bf053e945850b5875f",
    "source": "Publisher",
    "revision": "ebb2015119c907b064c512bf053e945850b5875f"
  },
  {
    "id": "fasttext-language",
    "name": "fastText Language ID 176",
    "publisher": "Meta / fastText",
    "purpose": "classify",
    "role": "Tool",
    "availability": "explore",
    "benefit": "Identify the language of a text",
    "example": "Route a document to an appropriate language-specific tool.",
    "limitation": "Short, mixed-language, or unusual text can be misidentified. Detects language and does not translate.",
    "languages": [
      "en",
      "zh",
      "multilingual"
    ],
    "languageLabel": "Multilingual \u00b7 176 languages",
    "weightMB": 0.917,
    "format": "fastText \u00b7 compressed FTZ",
    "runtime": "fastText",
    "license": "CC-BY-SA-3.0",
    "licenseUrl": "https://fasttext.cc/docs/en/language-identification.html",
    "files": [
      "lid.176.ftz"
    ],
    "setup": "Requires UTF-8 input and a fastText runtime. This compact classifier does not use ONNX or generate text.",
    "modelUrl": "https://github.com/facebookresearch/fastText",
    "filesUrl": "https://fasttext.cc/docs/en/language-identification.html",
    "source": "Publisher"
  },
  {
    "id": "nomic-embed",
    "name": "Nomic Embed Text v1.5",
    "publisher": "Nomic AI",
    "purpose": "search",
    "role": "Tool",
    "availability": "explore",
    "benefit": "Retrieve passages from English documents",
    "example": "Explore another embedding family for local notes and document search.",
    "limitation": "Dimensions, pooling, and prefixes differ from BGE. Existing BGE indexes cannot be reused.",
    "languages": [
      "en"
    ],
    "languageLabel": "English",
    "weightMB": 84.1,
    "format": "GGUF \u00b7 Q4_K_M",
    "runtime": "llama.cpp",
    "license": "Apache-2.0",
    "licenseUrl": "https://huggingface.co/nomic-ai/nomic-embed-text-v1.5-GGUF",
    "files": [
      "nomic-embed-text-v1.5.Q4_K_M.gguf"
    ],
    "setup": "Requires search_query: and search_document: prefixes and correct pooling. Long-context settings need separate verification.",
    "modelUrl": "https://huggingface.co/nomic-ai/nomic-embed-text-v1.5-GGUF",
    "filesUrl": "https://huggingface.co/nomic-ai/nomic-embed-text-v1.5-GGUF/tree/0188c9bf409793f810680a5a431e7b899c46104c",
    "source": "Publisher",
    "revision": "0188c9bf409793f810680a5a431e7b899c46104c"
  },
  {
    "id": "multilingual-rerank",
    "name": "mMARCO Multilingual MiniLM v2",
    "publisher": "Sentence Transformers",
    "purpose": "rerank",
    "role": "Tool",
    "availability": "explore",
    "benefit": "Rerank Chinese and multilingual search results",
    "example": "Score question and passage pairs after an initial search.",
    "limitation": "Reranks a shortlist; it does not search a library or generate answers by itself.",
    "languages": [
      "en",
      "zh",
      "multilingual"
    ],
    "languageLabel": "Multilingual \u00b7 including Chinese",
    "weightMB": 118.6,
    "format": "ONNX \u00b7 INT8 ARM64",
    "runtime": "ONNX Runtime",
    "license": "Apache-2.0",
    "licenseUrl": "https://huggingface.co/cross-encoder/mmarco-mMiniLMv2-L12-H384-v1",
    "files": [
      "onnx/model_qint8_arm64.onnx"
    ],
    "setup": "Requires the matching tokenizer and paired query/passage encoding. Compare scores within one query.",
    "modelUrl": "https://huggingface.co/cross-encoder/mmarco-mMiniLMv2-L12-H384-v1",
    "filesUrl": "https://huggingface.co/cross-encoder/mmarco-mMiniLMv2-L12-H384-v1/tree/1427fd652930e4ba29e8149678df786c240d8825",
    "source": "Publisher",
    "revision": "1427fd652930e4ba29e8149678df786c240d8825"
  },
  {
    "id": "deepfilter-audio",
    "name": "DeepFilterNet3",
    "publisher": "DeepFilterNet",
    "purpose": "audio",
    "role": "Tool",
    "availability": "explore",
    "benefit": "Reduce background noise in speech",
    "example": "Clean a noisy recording before transcription or listening.",
    "limitation": "Speech enhancement can alter the recording. This is not transcription, music separation, or speaker identification.",
    "languages": [
      "independent"
    ],
    "languageLabel": "Language-independent",
    "weightMB": 8.0,
    "format": "ONNX \u00b7 compressed model bundle",
    "runtime": "DeepFilterNet",
    "license": "MIT OR Apache-2.0",
    "licenseUrl": "https://github.com/Rikorose/DeepFilterNet#license",
    "files": [
      "DeepFilterNet3_onnx.tar.gz"
    ],
    "setup": "The 7,983,136-byte archive contains the networks and configuration. Requires DeepFilterNet preprocessing and 48 kHz audio; expanded files need more disk space.",
    "modelUrl": "https://github.com/Rikorose/DeepFilterNet",
    "filesUrl": "https://github.com/Rikorose/DeepFilterNet/blob/main/models/DeepFilterNet3_onnx.tar.gz",
    "source": "Publisher"
  },
  {
    "id": "smollm-chat",
    "name": "SmolLM2 360M Instruct",
    "publisher": "Hugging Face",
    "purpose": "write",
    "role": "Chat model",
    "availability": "explore",
    "benefit": "Explore small English writing tasks",
    "example": "Try constrained rewriting and simple extraction in English.",
    "limitation": "English-focused and limited in size. It is not a reliable factual or coding assistant.",
    "languages": [
      "en"
    ],
    "languageLabel": "English",
    "weightMB": 386.4,
    "format": "GGUF \u00b7 Q8_0",
    "runtime": "llama.cpp",
    "license": "Apache-2.0",
    "licenseUrl": "https://huggingface.co/HuggingFaceTB/SmolLM2-360M-Instruct",
    "files": [
      "smollm2-360m-instruct-q8_0.gguf"
    ],
    "setup": "Requires its chat template and tokenizer metadata. This publisher export is Q8_0; working memory exceeds the weight size.",
    "modelUrl": "https://huggingface.co/HuggingFaceTB/SmolLM2-360M-Instruct",
    "filesUrl": "https://huggingface.co/HuggingFaceTB/SmolLM2-360M-Instruct-GGUF/tree/593b5a2e04c8f3e4ee880263f93e0bd2901ad47f",
    "source": "Publisher",
    "revision": "593b5a2e04c8f3e4ee880263f93e0bd2901ad47f"
  },
  {
    "id": "lfm-small-chat",
    "name": "LFM2.5 350M",
    "publisher": "Liquid AI",
    "purpose": "write",
    "role": "Chat model",
    "availability": "explore",
    "benefit": "Try a compact multilingual chat family",
    "example": "Explore short rewriting and structured extraction with a different model architecture.",
    "limitation": "Small-model facts and code can be wrong. The custom license has commercial-use conditions.",
    "languages": [
      "en",
      "zh",
      "multilingual"
    ],
    "languageLabel": "Multilingual \u00b7 including Chinese",
    "weightMB": 229.3,
    "format": "GGUF \u00b7 Q4_K_M",
    "runtime": "llama.cpp",
    "license": "LFM Open License v1.0",
    "licenseUrl": "https://huggingface.co/LiquidAI/LFM2.5-350M-GGUF/blob/657e078c94084481950a2d555a941481f715536b/LICENSE",
    "files": [
      "LFM2.5-350M-Q4_K_M.gguf"
    ],
    "setup": "Requires LFM2 architecture support and the correct chat template. Not benchmarked or integrated in Cove.",
    "modelUrl": "https://huggingface.co/LiquidAI/LFM2.5-350M-GGUF",
    "filesUrl": "https://huggingface.co/LiquidAI/LFM2.5-350M-GGUF/tree/657e078c94084481950a2d555a941481f715536b",
    "source": "Publisher",
    "revision": "657e078c94084481950a2d555a941481f715536b"
  },
  {
    "id": "qwen3-chat",
    "name": "Qwen3 0.6B",
    "publisher": "Qwen \u00b7 bartowski conversion",
    "purpose": "write",
    "role": "Chat model",
    "availability": "explore",
    "benefit": "Explore a newer small multilingual chat model",
    "example": "Compare short writing and extraction behavior with another Qwen generation.",
    "limitation": "Thinking output can increase latency. Quality, stopping, and the template need separate evaluation.",
    "languages": [
      "en",
      "zh",
      "multilingual"
    ],
    "languageLabel": "Multilingual \u00b7 including Chinese",
    "weightMB": 484.2,
    "format": "GGUF \u00b7 Q4_K_M",
    "runtime": "llama.cpp",
    "license": "Apache-2.0",
    "licenseUrl": "https://huggingface.co/Qwen/Qwen3-0.6B",
    "files": [
      "Qwen_Qwen3-0.6B-Q4_K_M.gguf"
    ],
    "setup": "Requires Qwen3 template support and an explicit thinking/non-thinking policy. This conversion is not installed or tested by Cove.",
    "modelUrl": "https://huggingface.co/Qwen/Qwen3-0.6B",
    "filesUrl": "https://huggingface.co/bartowski/Qwen_Qwen3-0.6B-GGUF/tree/60b85c0e3d8fe0f6474f406922a26d12aca4550d",
    "source": "Community conversion",
    "revision": "60b85c0e3d8fe0f6474f406922a26d12aca4550d"
  },
  {
    "id": "kokoro-en",
    "name": "Kokoro 82M v1.0 \u00b7 English",
    "publisher": "hexgrad \u00b7 sherpa-onnx conversion",
    "purpose": "speak",
    "role": "Tool",
    "availability": "ready",
    "benefit": "Read English text aloud",
    "example": "Listen to answers with American or British voices.",
    "limitation": "Names and specialist terms may need pronunciation review.",
    "languages": [
      "en"
    ],
    "languageLabel": "English",
    "weightMB": 132.4,
    "format": "ONNX \u00b7 INT8",
    "runtime": "Bundled local speech runtime \u00b7 Apple Silicon",
    "license": "Apache-2.0",
    "licenseUrl": "https://huggingface.co/hexgrad/Kokoro-82M",
    "files": [
      "model.int8.onnx",
      "tokens.txt",
      "voices.bin",
      "lexicon-us-en.txt",
      "lexicon-gb-en.txt"
    ],
    "setup": "Cove downloads and verifies the complete model, voice, and language files. Choose a voice in On this Mac > Speech. Requires macOS 13.3 or later on Apple Silicon.",
    "modelUrl": "https://huggingface.co/hexgrad/Kokoro-82M",
    "filesUrl": "https://github.com/k2-fsa/sherpa-onnx/releases/tag/tts-models",
    "source": "Community conversion",
    "revision": "72c347230107ef8a31098ec4d468a605244beef5f1ed00db97efa13518800653"
  },
  {
    "id": "opus-zh-en",
    "name": "OPUS-MT ZH-EN",
    "publisher": "Helsinki-NLP",
    "purpose": "translate",
    "role": "Tool",
    "availability": "explore",
    "benefit": "Translate Chinese into English",
    "example": "Create an English version of a short Chinese passage offline.",
    "limitation": "Direction-specific translation. Names, terminology, and formatting can be mistranslated.",
    "languages": [
      "en",
      "zh"
    ],
    "languageLabel": "Chinese \u2192 English",
    "weightMB": 113.1,
    "format": "ONNX \u00b7 INT8 encoder + decoder",
    "runtime": "ONNX Runtime",
    "license": "CC-BY-4.0",
    "licenseUrl": "https://huggingface.co/Helsinki-NLP/opus-mt-zh-en",
    "files": [
      "onnx/encoder_model_quantized.onnx",
      "onnx/decoder_model_merged_quantized.onnx"
    ],
    "setup": "Requires both networks, matching SentencePiece/tokenizer files, and autoregressive decoding. The reverse direction uses a separate model.",
    "modelUrl": "https://huggingface.co/Helsinki-NLP/opus-mt-zh-en",
    "filesUrl": "https://huggingface.co/Xenova/opus-mt-zh-en/tree/39d480d52a9ea3065a1f117adfe4dbc55de10e6f",
    "source": "Community conversion",
    "revision": "39d480d52a9ea3065a1f117adfe4dbc55de10e6f"
  },
  {
    "id": "modnet-portrait",
    "name": "MODNet",
    "publisher": "ZHKKKe \u00b7 Xenova conversion",
    "purpose": "vision",
    "role": "Tool",
    "availability": "explore",
    "benefit": "Separate a portrait from its background",
    "example": "Estimate a foreground matte for a person in a picture.",
    "limitation": "Designed for portraits; it is not general object selection or image generation.",
    "languages": [
      "independent"
    ],
    "languageLabel": "Language-independent",
    "weightMB": 6.6,
    "format": "ONNX \u00b7 INT8",
    "runtime": "ONNX Runtime",
    "license": "Apache-2.0",
    "licenseUrl": "https://github.com/ZHKKKe/MODNet/blob/master/LICENSE",
    "files": [
      "onnx/model_quantized.onnx"
    ],
    "setup": "Requires matching resize, RGB normalization, and alpha-matte postprocessing.",
    "modelUrl": "https://github.com/ZHKKKe/MODNet",
    "filesUrl": "https://huggingface.co/Xenova/modnet/tree/fa2fa546052fba4c08921230a26cc69a333fca12",
    "source": "Community conversion",
    "revision": "fa2fa546052fba4c08921230a26cc69a333fca12"
  },
  {
    "id": "detr-objects",
    "name": "DETR ResNet 50",
    "publisher": "Meta \u00b7 Xenova conversion",
    "purpose": "vision",
    "role": "Tool",
    "availability": "explore",
    "benefit": "Locate common objects in a picture",
    "example": "Return bounding boxes and labels for common object categories.",
    "limitation": "Uses a fixed set of classes. Small or unusual objects may be missed.",
    "languages": [
      "independent"
    ],
    "languageLabel": "Language-independent",
    "weightMB": 43.1,
    "format": "ONNX \u00b7 INT8",
    "runtime": "ONNX Runtime",
    "license": "Apache-2.0",
    "licenseUrl": "https://huggingface.co/facebook/detr-resnet-50",
    "files": [
      "onnx/model_quantized.onnx"
    ],
    "setup": "Requires the matching image processor and coordinate/score postprocessing. This is detection, not OCR or image chat.",
    "modelUrl": "https://huggingface.co/facebook/detr-resnet-50",
    "filesUrl": "https://huggingface.co/Xenova/detr-resnet-50/tree/8be7ab59ff663484ee9ba2e8d8f267330d5ad03e",
    "source": "Community conversion",
    "revision": "8be7ab59ff663484ee9ba2e8d8f267330d5ad03e"
  },
  {
    "id": "multilingual-e5",
    "name": "Multilingual E5 Small",
    "publisher": "intfloat",
    "purpose": "search",
    "role": "Tool",
    "availability": "explore",
    "benefit": "Search Chinese and multilingual material",
    "example": "Match a question to related passages across multilingual documents.",
    "limitation": "Needs query and passage prefixes. Similarity is not answer confidence.",
    "languages": [
      "en",
      "zh",
      "multilingual"
    ],
    "languageLabel": "Multilingual \u00b7 including Chinese",
    "weightMB": 118.3,
    "format": "ONNX \u00b7 INT8",
    "runtime": "ONNX Runtime",
    "license": "MIT",
    "licenseUrl": "https://huggingface.co/intfloat/multilingual-e5-small",
    "files": [
      "onnx/model_quantized.onnx"
    ],
    "setup": "Requires the original tokenizer, mean pooling, normalization, and query:/passage: prefixes. These converted weights are a separate artifact.",
    "modelUrl": "https://huggingface.co/intfloat/multilingual-e5-small",
    "filesUrl": "https://huggingface.co/Xenova/multilingual-e5-small/tree/761b726dd34fb83930e26aab4e9ac3899aa1fa78",
    "source": "Community conversion",
    "revision": "761b726dd34fb83930e26aab4e9ac3899aa1fa78"
  },
  {
    "id": "multilingual-minilm",
    "name": "Multilingual MiniLM L12",
    "publisher": "Sentence Transformers",
    "purpose": "search",
    "role": "Tool",
    "availability": "explore",
    "benefit": "Search notes across languages",
    "example": "Find related passages in collections written in several languages.",
    "limitation": "Test retrieval on your own languages and documents. This is an embedding model, not a chat model.",
    "languages": [
      "en",
      "multilingual"
    ],
    "languageLabel": "Multilingual \u00b7 50 languages",
    "weightMB": 118.4,
    "format": "ONNX \u00b7 INT8 ARM64",
    "runtime": "ONNX Runtime",
    "license": "Apache-2.0",
    "licenseUrl": "https://huggingface.co/sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2",
    "files": [
      "onnx/model_qint8_arm64.onnx"
    ],
    "setup": "Requires the matching tokenizer, normalization, and mean-pooling configuration. The selected export targets ARM64.",
    "modelUrl": "https://huggingface.co/sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2",
    "filesUrl": "https://huggingface.co/sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2/tree/e8f8c211226b894fcb81acc59f3b34ba3efd5f42",
    "source": "Publisher",
    "revision": "e8f8c211226b894fcb81acc59f3b34ba3efd5f42"
  },
  {
    "id": "minilm-search",
    "name": "all-MiniLM-L6-v2",
    "publisher": "Sentence Transformers",
    "purpose": "search",
    "role": "Tool",
    "benefit": "Search English notes and documents",
    "example": "Retrieve related passages from a collection of English notes.",
    "limitation": "English-focused; use a Chinese model for Chinese documents.",
    "languages": [
      "en"
    ],
    "languageLabel": "English",
    "weightMB": 23.0,
    "format": "ONNX \u00b7 INT8 ARM64",
    "runtime": "ONNX Runtime",
    "license": "Apache-2.0",
    "files": [
      "onnx/model_qint8_arm64.onnx"
    ],
    "setup": "Use the ARM64 variant for Apple Silicon, together with the repository's tokenizer, configuration, and pooling settings.",
    "modelUrl": "https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2",
    "filesUrl": "https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2/tree/1110a243fdf4706b3f48f1d95db1a4f5529b4d41",
    "source": "Publisher",
    "availability": "explore",
    "licenseUrl": "https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2",
    "revision": "1110a243fdf4706b3f48f1d95db1a4f5529b4d41"
  },
  {
    "id": "minilm-rerank",
    "name": "MS MARCO MiniLM L6 v2",
    "publisher": "Sentence Transformers",
    "purpose": "rerank",
    "role": "Tool",
    "benefit": "Put more relevant search results first",
    "example": "Score a shortlist of English passages against your question.",
    "limitation": "Needs initial search results; does not search or write answers by itself.",
    "languages": [
      "en"
    ],
    "languageLabel": "English",
    "weightMB": 23.2,
    "format": "ONNX \u00b7 INT8 ARM64",
    "runtime": "ONNX Runtime",
    "license": "Apache-2.0",
    "files": [
      "onnx/model_qint8_arm64.onnx"
    ],
    "setup": "Requires tokenizer and configuration from the same repository. This is a reranker, not an embedding model.",
    "modelUrl": "https://huggingface.co/cross-encoder/ms-marco-MiniLM-L6-v2",
    "filesUrl": "https://huggingface.co/cross-encoder/ms-marco-MiniLM-L-6-v2/tree/233902d25c440f23af6f7d6e94d2946bac0bee0a",
    "source": "Publisher",
    "availability": "explore",
    "licenseUrl": "https://huggingface.co/cross-encoder/ms-marco-MiniLM-L6-v2",
    "revision": "233902d25c440f23af6f7d6e94d2946bac0bee0a"
  },
  {
    "id": "whisper-tiny",
    "name": "Whisper Tiny",
    "publisher": "OpenAI \u00b7 whisper.cpp conversion",
    "purpose": "voice",
    "role": "Tool",
    "benefit": "Turn short voice notes into text",
    "example": "Transcribe a short recording locally before working with its text.",
    "limitation": "Accuracy varies by language and recording quality. Tiny can miss words in difficult audio.",
    "languages": [
      "en",
      "zh",
      "multilingual"
    ],
    "languageLabel": "Multilingual",
    "weightMB": 77.7,
    "format": "GGML \u00b7 F16",
    "runtime": "whisper.cpp",
    "license": "MIT",
    "files": [
      "ggml-tiny.bin"
    ],
    "setup": "Choose ggml-tiny.bin for multilingual transcription. The .en variant is English-only. Requires an audio transcription runtime.",
    "modelUrl": "https://github.com/ggml-org/whisper.cpp",
    "filesUrl": "https://huggingface.co/ggerganov/whisper.cpp/tree/5359861c739e955e79d9a303bcbc70fb988958b1",
    "source": "Community conversion",
    "availability": "explore",
    "licenseUrl": "https://github.com/ggml-org/whisper.cpp",
    "revision": "5359861c739e955e79d9a303bcbc70fb988958b1"
  },
  {
    "id": "whisper-base",
    "name": "Whisper Base",
    "publisher": "OpenAI \u00b7 whisper.cpp conversion",
    "purpose": "voice",
    "role": "Tool",
    "benefit": "Explore a larger voice transcription model",
    "example": "Compare transcription quality with Tiny on your own recordings.",
    "limitation": "Uses more resources than Tiny; noisy audio and names still need review.",
    "languages": [
      "en",
      "zh",
      "multilingual"
    ],
    "languageLabel": "Multilingual",
    "weightMB": 148.0,
    "format": "GGML \u00b7 F16",
    "runtime": "whisper.cpp",
    "license": "MIT",
    "files": [
      "ggml-base.bin"
    ],
    "setup": "Choose the multilingual base file, not base.en. The whisper.cpp runtime is separate from the model weights.",
    "modelUrl": "https://github.com/ggml-org/whisper.cpp",
    "filesUrl": "https://huggingface.co/ggerganov/whisper.cpp/tree/5359861c739e955e79d9a303bcbc70fb988958b1",
    "source": "Community conversion",
    "availability": "explore",
    "licenseUrl": "https://github.com/ggml-org/whisper.cpp",
    "revision": "5359861c739e955e79d9a303bcbc70fb988958b1"
  },
  {
    "id": "silero-vad",
    "name": "Silero VAD",
    "publisher": "Silero",
    "purpose": "audio",
    "role": "Tool",
    "benefit": "Detect when someone is speaking",
    "example": "Separate speech from silence before transcribing a voice note.",
    "limitation": "Detects speech segments only; does not transcribe words or identify speakers.",
    "languages": [
      "independent"
    ],
    "languageLabel": "Language-independent",
    "weightMB": 2.3,
    "format": "ONNX",
    "runtime": "ONNX Runtime",
    "license": "MIT",
    "files": [
      "silero_vad.onnx"
    ],
    "setup": "Requires audio preprocessing and stateful inference using the publisher's supported sample rates and window sizes.",
    "modelUrl": "https://github.com/snakers4/silero-vad",
    "filesUrl": "https://github.com/snakers4/silero-vad/blob/master/src/silero_vad/data/silero_vad.onnx",
    "source": "Publisher",
    "availability": "explore",
    "licenseUrl": "https://github.com/snakers4/silero-vad"
  },
  {
    "id": "sentiment",
    "name": "DistilBERT SST-2",
    "publisher": "Hugging Face \u00b7 Xenova conversion",
    "purpose": "classify",
    "role": "Tool",
    "availability": "explore",
    "benefit": "Tag the sentiment of English text",
    "example": "Label a short English review as positive or negative.",
    "limitation": "Binary review sentiment is not an emotion detector. Sarcasm and other domains can be misclassified.",
    "languages": [
      "en"
    ],
    "languageLabel": "English",
    "weightMB": 67.6,
    "format": "ONNX \u00b7 INT8",
    "runtime": "ONNX Runtime",
    "license": "Apache-2.0",
    "licenseUrl": "https://huggingface.co/distilbert/distilbert-base-uncased-finetuned-sst-2-english",
    "files": [
      "onnx/model_quantized.onnx"
    ],
    "setup": "Requires the matching tokenizer and class labels. Long documents need explicit segmentation.",
    "modelUrl": "https://huggingface.co/distilbert/distilbert-base-uncased-finetuned-sst-2-english",
    "filesUrl": "https://huggingface.co/Xenova/distilbert-base-uncased-finetuned-sst-2-english/tree/0b6928efcb76139cae2c6881d49cda67fe119f42",
    "source": "Community conversion",
    "revision": "0b6928efcb76139cae2c6881d49cda67fe119f42"
  },
  {
    "id": "kitten-nano-en",
    "name": "Kitten TTS Nano 0.8 \u00b7 INT8",
    "publisher": "KittenML \u00b7 sherpa-onnx conversion",
    "purpose": "speak",
    "role": "Tool",
    "availability": "ready",
    "benefit": "Add a tiny English reading voice",
    "example": "Read short answers with an eight-voice, 31 MB download.",
    "limitation": "English only. The smallest download trades naturalness for size.",
    "languages": [
      "en"
    ],
    "languageLabel": "English",
    "weightMB": 31.2,
    "format": "ONNX \u00b7 INT8",
    "runtime": "Bundled local speech runtime \u00b7 Apple Silicon",
    "license": "Apache-2.0",
    "licenseUrl": "https://huggingface.co/KittenML/kitten-tts-nano-0.8",
    "files": [
      "model.int8.onnx",
      "tokens.txt",
      "voices.bin"
    ],
    "setup": "Cove downloads and verifies the complete model, voice, and language files. Choose a voice in On this Mac > Speech. Requires macOS 13.3 or later on Apple Silicon.",
    "modelUrl": "https://huggingface.co/KittenML/kitten-tts-nano-0.8",
    "filesUrl": "https://github.com/k2-fsa/sherpa-onnx/releases/tag/tts-models",
    "source": "Community conversion",
    "revision": "6fa5be852612ce761094ba74ee6123b4fc4acfefa79bf64dc63acae4a83af2fd"
  },
  {
    "id": "melo-zh-en",
    "name": "MeloTTS \u00b7 Chinese + English",
    "publisher": "MyShell \u00b7 sherpa-onnx conversion",
    "purpose": "speak",
    "role": "Tool",
    "availability": "ready",
    "benefit": "Read Chinese and English with one voice",
    "example": "Use one Mandarin voice for bilingual reading.",
    "limitation": "One preset voice. Long passages are read in sections.",
    "languages": [
      "zh",
      "en"
    ],
    "languageLabel": "Chinese and English",
    "weightMB": 167.0,
    "format": "ONNX \u00b7 bilingual bundle",
    "runtime": "Bundled local speech runtime \u00b7 Apple Silicon",
    "license": "MIT",
    "licenseUrl": "https://github.com/myshell-ai/MeloTTS",
    "files": [
      "model.onnx",
      "tokens.txt",
      "lexicon.txt",
      "date.fst",
      "number.fst",
      "phone.fst",
      "new_heteronym.fst"
    ],
    "setup": "Cove downloads and verifies the complete model, voice, and language files. Choose a voice in On this Mac > Speech. Requires macOS 13.3 or later on Apple Silicon.",
    "modelUrl": "https://github.com/myshell-ai/MeloTTS",
    "filesUrl": "https://github.com/k2-fsa/sherpa-onnx/releases/tag/tts-models",
    "source": "Community conversion",
    "revision": "e58351ed7149f290a54534538badd4077cdbe6fddc964b24d0bee870415d1514"
  },
  {
    "id": "pocket-tts-en",
    "name": "Pocket TTS 18M \u00b7 Preset voices",
    "publisher": "Kyutai",
    "purpose": "speak",
    "role": "Tool",
    "availability": "ready",
    "benefit": "Try expressive English voices",
    "example": "Read answers with Alba, Anna, or Bill Boerst, entirely offline.",
    "limitation": "English preset voices only. Voice cloning is not included.",
    "languages": [
      "en"
    ],
    "languageLabel": "English",
    "weightMB": 125.4,
    "format": "Safetensors \u00b7 preset voices",
    "runtime": "Bundled local speech runtime \u00b7 Apple Silicon",
    "license": "CC-BY-4.0",
    "licenseUrl": "https://huggingface.co/kyutai/pocket-tts-without-voice-cloning",
    "files": [
      "alba.safetensors",
      "anna.safetensors",
      "bill_boerst.safetensors",
      "model.safetensors",
      "tokenizer.model"
    ],
    "setup": "Cove downloads and verifies the complete model, voice, and language files. Choose a voice in On this Mac > Speech. Requires macOS 13.3 or later on Apple Silicon.",
    "modelUrl": "https://huggingface.co/kyutai/pocket-tts-without-voice-cloning",
    "filesUrl": "https://huggingface.co/kyutai/pocket-tts-without-voice-cloning/tree/a7056f505a4a8ca72d8b5fb1440071d6f1a35739/languages/english_18m_2026-10",
    "source": "Publisher",
    "revision": "c3a28c28abac59e9d9caf9a4053a0e5d9677c181b15e7c1f1e3566a67c951c12"
  }
] satisfies LocalModel[];
