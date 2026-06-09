#pragma once

#include "protocol.h"

#include <atomic>
#include <deque>
#include <mutex>
#include <string>
#include <thread>

namespace playoutd {

class ControlServer {
 public:
  explicit ControlServer(std::string socketPath);
  ~ControlServer();

  ControlServer(const ControlServer&) = delete;
  ControlServer& operator=(const ControlServer&) = delete;

  bool start();
  void stop();
  bool drainCommands(std::deque<ControlCommand>& out);

 private:
  void listenLoop();

  std::string socketPath_;
  std::atomic<bool> running_{false};
  int listenFd_ = -1;
  std::thread thread_;
  std::mutex queueMutex_;
  std::deque<ControlCommand> queue_;
};

} // namespace playoutd
