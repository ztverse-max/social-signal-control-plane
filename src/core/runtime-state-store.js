import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

const DEFAULT_STATE = {
  version: 1,
  customTargets: {},
  channels: []
};

function clone(value) {
  return structuredClone(value);
}

function resolveTargetId(target = {}) {
  return (
    target.targetId ??
    target.id ??
    target.userId ??
    target.uid ??
    target.secUserId ??
    target.fakeId ??
    target.accountName ??
    target.screenName ??
    target.profileUrl ??
    target.keyword
  );
}

function normalizeTarget(target = {}) {
  return {
    ...target,
    targetId: resolveTargetId(target) ?? randomUUID(),
    isCustom: true
  };
}

function normalizeChannel(channel = {}) {
  return {
    ...channel,
    id: channel.id ?? randomUUID()
  };
}

export class RuntimeStateStore {
  constructor({ cwd = process.cwd(), filePath = "data/runtime-state.json" } = {}) {
    this.cwd = cwd;
    this.filePath = path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath);
    this.state = undefined;
  }

  async load() {
    if (this.state) {
      return clone(this.state);
    }

    try {
      const payload = await fs.readFile(this.filePath, "utf8");
      this.state = {
        ...DEFAULT_STATE,
        ...JSON.parse(payload)
      };
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw error;
      }

      this.state = clone(DEFAULT_STATE);
      await this.#persist();
    }

    return clone(this.state);
  }

  async #persist() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(this.state, null, 2), "utf8");
  }

  async getState() {
    return this.load();
  }

  async upsertTarget(platformId, target, { previousTargetId } = {}) {
    await this.load();
    const normalizedTarget = normalizeTarget(target);
    const platformTargets = this.state.customTargets[platformId] ?? [];
    const nextTargets = platformTargets.filter(
      (entry) =>
        entry.targetId !== normalizedTarget.targetId &&
        (!previousTargetId || entry.targetId !== previousTargetId)
    );

    nextTargets.push(normalizedTarget);
    this.state.customTargets[platformId] = nextTargets;
    await this.#persist();
    return clone(normalizedTarget);
  }

  async removeTarget(platformId, targetId) {
    await this.load();
    const platformTargets = this.state.customTargets[platformId] ?? [];
    this.state.customTargets[platformId] = platformTargets.filter((entry) => entry.targetId !== targetId);
    await this.#persist();
  }

  async upsertChannel(channel) {
    await this.load();
    const normalizedChannel = normalizeChannel(channel);
    this.state.channels = this.state.channels.filter((entry) => entry.id !== normalizedChannel.id);
    this.state.channels.push(normalizedChannel);
    await this.#persist();
    return clone(normalizedChannel);
  }

  async removeChannel(channelId) {
    await this.load();
    this.state.channels = this.state.channels.filter((entry) => entry.id !== channelId);
    await this.#persist();
  }
}
