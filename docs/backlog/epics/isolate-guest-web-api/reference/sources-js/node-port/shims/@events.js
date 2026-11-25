// events: the two members event_target/abort_controller read; the guest binds rifty's events.
module.exports = {
  defaultMaxListeners: 10,
  kMaxEventTargetListeners: Symbol('events.maxEventTargetListeners'),
  kMaxEventTargetListenersWarned: Symbol('events.maxEventTargetListenersWarned'),
};
