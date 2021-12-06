import { Component, sys } from "cc";
import mobx, {
  IAutorunOptions,
  IReactionDisposer,
  IReactionOptions,
  IReactionPublic,
} from "mobx";

const { autorun, configure, reaction, runInAction } = mobx;
if (sys.isBrowser) {
  (window as any).mobx = mobx;
}
configure({ enforceActions: "observed", computedRequiresReaction: true });

type AnyObject = Object;
const observerProtoMapForAutoRun = new WeakMap<AnyObject, AutoRunConfig[]>();
const observerProtoMapForReaction = new WeakMap<AnyObject, ReactionConfig[]>();

export const observer = <T extends { new (...args: any[]): Component }>(
  constructor: T
) => {
  return class ObserverClass extends constructor {
    _disposerAtDisable: Map<string | symbol, IReactionDisposer>;
    _disposerAtDestroy: Map<string | symbol, IReactionDisposer>;
    _keepAutorunList: Map<string | symbol, AutoRunConfig>;
    _autorunList: Map<string | symbol, AutoRunConfig>;
    _keepReactionList: Map<string | symbol, ReactionConfig>;
    _reactionList: Map<string | symbol, ReactionConfig>;

    caller: () => void;

    /**
     * @override
     */
    constructor(...args: any[]) {
      super(...args);

      // get all reaction by prototype chain
      let p = Object.getPrototypeOf(this);
      do {
        const renderFunctionList = observerProtoMapForAutoRun.get(p);
        if (renderFunctionList?.length) {
          this._keepAutorunList = this._keepAutorunList || new Map();
          this._autorunList = this._autorunList || new Map();
          renderFunctionList.forEach((r) => {
            if (r.opts?.keep) {
              this._keepAutorunList.set(r.key, r);
            } else {
              this._autorunList.set(r.key, r);
            }
          });
        }

        const reactionFunctionList = observerProtoMapForReaction.get(p);
        if (reactionFunctionList?.length) {
          this._keepReactionList = this._keepReactionList || new Map();
          this._reactionList = this._reactionList || new Map();
          reactionFunctionList.forEach((r) => {
            if (r.opts?.keep) {
              this._keepReactionList.set(r.key, r);
            } else {
              this._reactionList.set(r.key, r);
            }
          });
        }
      } while ((p = Object.getPrototypeOf(p)));
    }

    /**
     * @override
     */
    onEnable(): void {
      super.onEnable?.();
      this.bindRender();
    }

    /**
     * 手動綁定 render。用於 start 沒辦法觸發的情境 (ex. node.active = false) 時可以呼叫手動綁定
     */
    bindRender(caller = this.onEnable) {
      // secondary bind
      if (this.caller) {
        this._bindAutorun(this._autorunList);
        this._bindReaction(this._reactionList);
      } else {
        // first bind
        if (caller !== this.onEnable) {
          this._autorunList.forEach((value, key) => {
            value.opts = value.opts || {};
            value.opts.keep = true;
            this._keepAutorunList.set(key, value);
          });
          this._autorunList.clear();
        }

        this._bindAutorun(this._autorunList);
        this._bindAutorun(this._keepAutorunList);
        this._bindReaction(this._reactionList);
        this._bindReaction(this._keepReactionList);
        this.caller = caller;
      }
    }

    private _bindReaction(reactionList: Map<string | symbol, ReactionConfig>) {
      if (reactionList?.size) {
        reactionList.forEach((config) => {
          const disposerMap = this._getDisposerMap(config);
          if (!disposerMap.has(config.key)) {
            disposerMap.set(config.key, (this as any)[config.key]());
          }
        });
      }
    }

    private _bindAutorun(autorunList: Map<string | symbol, AutoRunConfig>) {
      if (autorunList?.size) {
        autorunList.forEach((config) => {
          const disposerMap = this._getDisposerMap(config);
          if (!disposerMap.has(config.key)) {
            disposerMap.set(
              config.key,
              autorun((this as any)[config.key].bind(this), {
                name: `${constructor.name}.${config.key.toString()}`,
                ...config.opts,
              })
            );
          }
        });
      }
    }

    /**
     * @override
     */
    onDisable() {
      this._disposeAtDisable();
      super.onDisable?.();
    }

    /**
     * @override
     */
    onDestroy() {
      this._disposeAll();
      super.onDestroy && super.onDestroy();
    }

    /**
     * @override
     */
    _destruct() {
      // fix that when node.onLoad has not been called but bindRender has been called, onDestroy will not be called
      // so we must call the dispose again.
      this._disposeAll();

      // cocos will set all property to null, so we must call destruction on action.
      runInAction(() => {
        super._destruct && super._destruct();
      });
    }

    _disposeAtDisable() {
      if (this._disposerAtDisable) {
        this._disposerAtDisable.forEach((x) => x());
        this._disposerAtDisable.clear();
      }
    }

    _disposeAll() {
      this._disposeAtDisable();
      if (this._disposerAtDestroy) {
        this._disposerAtDestroy.forEach((x) => x());
        this._disposerAtDestroy.clear();
      }
      this.caller = null;
    }

    _getDisposerMap(config: { opts: { keep?: boolean } }) {
      if (config.opts?.keep) {
        this._disposerAtDestroy = this._disposerAtDestroy || new Map();
        return this._disposerAtDestroy;
      } else {
        this._disposerAtDisable = this._disposerAtDisable || new Map();
        return this._disposerAtDisable;
      }
    }
  };
};

///
/// Decorator
///
interface DecoratorFunc {
  (
    target: AnyObject,
    key: string | symbol,
    baseDescriptor: PropertyDescriptor
  ): void;
}

interface OptionalDecoratorFunc<T> {
  (opts?: T): DecoratorFunc;
}

///
/// Render
///

type AutoRunOpts = IAutorunOptions & { keep?: boolean };

interface AutoRunConfig {
  key: string | symbol;
  opts: AutoRunOpts;
}

type IRender = DecoratorFunc & OptionalDecoratorFunc<AutoRunOpts>;

export const render: IRender = function (...args: any[]) {
  if (args.length === 3) {
    render1(args[0], args[1], args[2]);
  } else {
    return render2(args[0]);
  }
};

const _pushToRenderList = (
  target: AnyObject,
  key: string | symbol,
  opts?: AutoRunOpts
) => {
  const renderFunctionList =
    observerProtoMapForAutoRun.has(target) === false
      ? observerProtoMapForAutoRun.set(target, []).get(target)
      : observerProtoMapForAutoRun.get(target);
  renderFunctionList.push({ key, opts });
};

const render1: DecoratorFunc = (
  target: Component,
  key: string | symbol,
  descriptor: TypedPropertyDescriptor<() => void>
) => {
  _pushToRenderList(target, key);
};

const render2: OptionalDecoratorFunc<AutoRunOpts> = (opts?: AutoRunOpts) => {
  return (
    target: AnyObject,
    key: string,
    descriptor: TypedPropertyDescriptor<() => void>
  ) => {
    _pushToRenderList(target, key, opts);
  };
};

///
/// Reactor
///
type ReactionOpts = IReactionOptions & { keep?: boolean };

interface ReactionConfig {
  key: string | symbol;
  opts: ReactionOpts;
}

type IReactor = DecoratorFunc & OptionalDecoratorFunc<ReactionOpts>;

export const reactor: IReactor = function (...args: any[]) {
  if (args.length === 3) {
    reactor1(args[0], args[1], args[2]);
  } else {
    return reactor2(args[0]);
  }
};

const _pushToReactionList = (
  target: AnyObject,
  key: string | symbol,
  opts?: ReactionOpts
) => {
  const reactorFunctionList =
    observerProtoMapForReaction.has(target) === false
      ? observerProtoMapForReaction.set(target, []).get(target)
      : observerProtoMapForReaction.get(target);
  reactorFunctionList.push({ key, opts });
};

const reactor1: DecoratorFunc = (
  target: any,
  key: string | symbol,
  descriptor: TypedPropertyDescriptor<() => IReactionDisposer>
) => {
  _pushToReactionList(target, key);
};

const reactor2 = <T, O extends Component>(
  expression: (r: IReactionPublic) => T
) => {
  return (
    target: O,
    key: string,
    descriptor: TypedPropertyDescriptor<(arg: T) => void>
  ) => {
    _pushToReactionList(target, key); // TODO: add Options
    const _value = descriptor.value as (arg: T) => void;
    descriptor.value = function (this: O) {
      return reaction(expression.bind(this), _value.bind(this), {
        name: `${target.constructor.name}.${key}`,
      });
    };
  };
};

/**
 * 和 reactor1 搭配进行副作用操作
 */
export const react = <T>(
  expression: (r: IReactionPublic) => T,
  effect: (arg: T, r: IReactionPublic) => void,
  opts: ReactionOpts = { fireImmediately: true }
): IReactionDisposer => {
  return reaction(expression, effect, opts); // TODO: move opts to decorator
};
