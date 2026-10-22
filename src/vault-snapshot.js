// 统一的保险库只读快照：提醒、邮件和统计必须看到同一组集合。
function snapshotVault(vault) {
  return {
    config: vault.config.data,
    profile: vault.profile.data,
    preferences: vault.preferences.list(),
    people: vault.people.list(),
    events: vault.events.list(),
    wishes: vault.wishes.list(),
    gifts: vault.gifts.list(),
    albums: vault.albums.list(),
    memories: vault.memories.list().slice().sort((a, b) => (b.takenAt || '').localeCompare(a.takenAt || ''))
  };
}

module.exports = { snapshotVault };