{
  "targets": [{
    "target_name": "decklink",
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
    "msbuild_toolset": "v143",
    "msvs_settings": {
      "VCCLCompilerTool": {
        "ExceptionHandling": 1,
        "AdditionalOptions": ["/std:c++17", "/W3", "/Zc:__cplusplus"]
      },
      "VCLinkerTool": {
        "AdditionalDependencies": ["ole32.lib", "oleaut32.lib"]
      }
    }
  }]
}
