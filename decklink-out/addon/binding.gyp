{
  "variables": {
    "decklink_sdk_linux%": "<(module_root_dir)/bmd-sdk/include"
  },
  "targets": [{
    "target_name": "decklink",
    "conditions": [
      ["OS=='win'", {
        "sources": ["decklink.cpp"],
        "include_dirs": [
          "<!@(node -p \"require('node-addon-api').include\")",
          "include"
        ],
        "defines": [
          "NAPI_DISABLE_CPP_EXCEPTIONS",
          "WIN32_LEAN_AND_MEAN",
          "NOMINMAX",
          "_WIN32_WINNT=0x0601",
          "UNICODE",
          "_UNICODE"
        ],
        "msvs_toolset": "v143",
        "msvs_settings": {
          "VCCLCompilerTool": {
            "ExceptionHandling": 1,
            "AdditionalOptions": ["/std:c++17", "/W3", "/Zc:__cplusplus"]
          },
          "VCLinkerTool": {
            "AdditionalDependencies": ["ole32.lib", "oleaut32.lib"]
          }
        }
      }],
      ["OS=='linux'", {
        "sources": [
          "decklink.cpp",
          "bmd-sdk/DeckLinkAPIDispatch.cpp"
        ],
        "include_dirs": [
          "<!@(node -p \"require('node-addon-api').include\")",
          "<(decklink_sdk_linux)"
        ],
        "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS"],
        "cflags_cc": [
          "-std=c++17",
          "-fno-rtti",
          "-Wno-multichar"
        ],
        "libraries": [
          "-ldl",
          "-lpthread"
        ]
      }]
    ]
  }]
}
