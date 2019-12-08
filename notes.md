**NOTES**

### 整体流程
```javascript
import { SyncHook } from 'tapable';

const hook = new SyncHook(); // 创建钩子对象
hook.intercept({
    register: () => console.log('register called'),
    context: true
})
hook.tap('logPlugin', () => console.log('被勾了')); // tap方法注册钩子回调
hook.tap('log2Plugin', () => console.log('被勾了2'));
hook.call(); // call方法调用钩子，打印出‘被勾了’三个字
```


执行过程：
- 1、Hooks基类，提供了 taps、interceptors的注册以及 call、callAsync、promsie 等调用方法
- 2、hook.intercept ，将 interceptor注册在实例的interceptors属性上，将tap注册到taps属性上
- 3、调用 call 方法，首先会调用hook实例的compile方法，也就是 syncHook的compile方法，这个方法返回一个通过 taps、interceptors等组装成的 compiler方法，然后用call方法的参数调用这个compiler方法
- 4、compiler的组装，SyncHook文件中实例化了一个 SyncHookCodeFactory类，它继承 HookCodeFactory 类，并复写了 content方法。主要的组装都是在 SyncHookCodeFactory类中完成的，基本操作是，先调用 factory.init，将init掉this.options，然后调用create创建compiler。首先是调用header获得header的代码，然后content，content的调用实际是调用 SyncHookCodeFactory 的content方法，返回的是content 的内容，最终header与content组装后通过new Fuction获得最终的compiler方法

#### 分类
按照两种分类方法，执行顺序
- 普通hook，依次执行，执行结果无关联
- waterfall，依次执行，上一个的执行结果是下一个的输入
- bail，只要有一个有返回，剩余不执行
- loop，循环

按照同步与不同步分类
- Sync，同步，只有tap方法添加tap
- AsyncSeries，异步系列，顺序执行，有tap、tapAsync、tapPromise方法添加tap
- AsyncParallel，异步同步，各tap同时开始执行，有tap、tapAsync、tapPromise方法添加tap

#### intercept
可以通过intercept方法注册interceptor实例如下
```javascript
import {
    SyncHook,
    AsyncParallelHook
} from 'tapable';

class Car {
    constructor() {
        this.hooks = {
            // accelerate: new SyncHook(["newSpeed"]),
            // brake: new SyncHook(),
            calculateRoutes: new AsyncParallelHook(["source", "target", "routesList"])
        }
    }

    // setSpeed(newSpeed) {
    //     this.hooks.accelerate.call(newSpeed);
    // }

    useNavigationSystemPromise(source, target) {
        const routesList = [];
        return this.hooks.calculateRoutes.promise(source, target, routesList).then((res) => {
            console.log('routesList', routesList);
            return routesList;
        })
    }
}

const myCar = new Car();

// myCar.hooks.brake.tap("WarningLampPlugin", () => console.log('warningLamp on'))
// myCar.hooks.accelerate.tap('LoggerPlugin', newSpeed => console.log(`Accelerating to ${newSpeed}`))
myCar.hooks.calculateRoutes.tapPromise("GoogleMapPlugin", (source, target, routesList) => {
    return new Promise(resolve => {
        console.log(`start in tapPromise`);
        setTimeout(() => {
            resolve(`${source} to ${target}`);
        }, 1000)
    }).then((route) => {
        routesList.push(route);
    })
})
myCar.hooks.calculateRoutes.intercept({
    context: true,
    call: (source, target, routesList) => {
        console.log('starting to calculate routes');
    },
    tap: (context, tapInfo) => {
        console.log(`in intercept tap. context: ${context}`);
    },
    register: (tapInfo) => {
        console.log(`${tapInfo.name} is doing its job`);
        return tapInfo;
    }
});

myCar.hooks.calculateRoutes.tap("NoisePlugin", () => {
    console.log('add NoisePlugin');
})

// myCar.setSpeed(111);
myCar.useNavigationSystemPromise('source1', 'target1');
```

执行打印顺序为：
```md
GoogleMapPlugin is doing its job
NoisePlugin is doing its job
starting to calculate routes
in intercept tap. context: undefined
start in tapPromise
in intercept tap. context: undefined
add NoisePlugin
routesList ["source1 to target1"]
```

intercept几个方法的执行时机
- call，当hook被触发，也就是调用tap、promise或者callAsync时触发一次
- tap，每次执行一个tap，会触发一次interceptor的tap方法
- loop，开始新的循环时触发
- register，注册时，会在已注册的每个tap上执行一次，后续每次注册tap，都会依次执行已注册interceptor的register方法

解释上面的打印
- 执行tapPromise时，什么都不会打印，此时注册了第一个tap给calculateRoutes这个hook
- 执行intercept方法时，会在第一次通过tapPromise注册的tap上执行register方法，打印 `GoogleMapPlugin is doing its job`
- 执行tap方法时注册第二个tap，此时会执行已经注册的register，打印`NoisePlugin is doing its job`
- 执行useNavigationSystemPromise，内部调用promise方法，生成compiler并执行，生成的compiler可见下面代码
- 调用promise，intercept的call方法被调用，如果有多个interceptor，会依次调用call方法，打印`starting to calculate routes`
- 因为是 AsyncParallelHook ，所以注册的两个tap会并行，先执行 GoogleMapPlugin ，执行前，先调用interceptor的tap方法，打印 `in intercept tap. context: undefined`，然后执行 GoogleMapPlugin，打印 `start in tapPromise`，再执行 NoisePlugin ，同样，执行前先调用interceptor的tap方法，打印`in intercept tap. context: undefined`，然后执行 NoisePlugin，打印 `add NoisePlugin`，最终 GoogleMapPlugin 内部的Promise执行完毕，打印`routesList ["source1 to target1"]`

#### compiler
上面例子生成的compiler

```javascript
(function anonymous(source, target, routesList) {
    "use strict";
    return new Promise((_resolve, _reject) => {
        var _sync = true;
        function _error(_err) {
            if (_sync)
                _resolve(Promise.resolve().then(() => { throw _err; }));
            else
                _reject(_err);
        };
        var _context;
        var _x = this._x;
        var _taps = this.taps;
        var _interceptors = this.interceptors;
        _interceptors[0].call(_context, source, target, routesList);
        do {
            var _counter = 2;
            var _done = () => {
                _resolve();
            };
            if (_counter <= 0) break;
            var _tap0 = _taps[0];
            _interceptors[0].tap(_context, _tap0);
            var _fn0 = _x[0];
            var _hasResult0 = false;
            var _promise0 = _fn0(source, target, routesList);
            if (!_promise0 || !_promise0.then)
                throw new Error('Tap function (tapPromise) did not return promise (returned ' + _promise0 + ')');
            _promise0.then(_result0 => {
                _hasResult0 = true;
                if (--_counter === 0) _done();
            }, _err0 => {
                if (_hasResult0) throw _err0;
                if (_counter > 0) {
                    _error(_err0);
                    _counter = 0;
                }
            });
            if (_counter <= 0) break;
            var _tap1 = _taps[1];
            _interceptors[0].tap(_context, _tap1);
            var _fn1 = _x[1];
            var _hasError1 = false;
            try {
                _fn1(source, target, routesList);
            } catch (_err) {
                _hasError1 = true;
                if (_counter > 0) {
                    _error(_err);
                    _counter = 0;
                }
            }
            if (!_hasError1) {
                if (--_counter === 0) _done();
            }
        } while (false);
        _sync = false;
    });

})
```