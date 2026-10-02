"""Measure the real factory and Profile on an isolated localhost Cancun chain.

No public RPC, private key input, existing node reset, or real funds are used.
Selectors come from actual compiler artifacts. Read estimates are not paid fees.
"""
from pathlib import Path
import argparse, datetime, hashlib, json, os, socket, subprocess, time
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
CHAIN_ID = 31358
TX_CAP = 1 << 24

def word(value):
    return int(value, 16).to_bytes(32, 'big') if isinstance(value, str) else value.to_bytes(32, 'big')

def encode_profile(land, epoch, fields):
    tails = []
    heads = [word(land), word(epoch)]
    offset = 5 * 32
    for field in fields:
        raw = field.encode('utf-8')
        tail = word(len(raw)) + raw + bytes((-len(raw)) % 32)
        heads.append(word(offset))
        tails.append(tail)
        offset += len(tail)
    return b''.join(heads + tails)

def decode_profile(encoded):
    raw = bytes.fromhex(encoded[2:])
    number = lambda at: int.from_bytes(raw[at:at+32], 'big')
    strings = []
    for index in (3, 4, 5):
        offset = number(index * 32)
        strings.append(raw[offset+32:offset+32+number(offset)].decode('utf-8'))
    return {'valid': bool(number(0)), 'controller': '0x'+raw[44:64].hex(),
            'epoch': number(64), 'fields': strings}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--anvil', default=os.environ.get('ANVIL_BIN', 'anvil'))
    parser.add_argument('--port', type=int, default=18558)
    args = parser.parse_args()
    if not 1024 <= args.port <= 65535:
        raise SystemExit('Use an unprivileged localhost port')
    with socket.socket() as check:
        check.bind(('127.0.0.1', args.port))
    version = subprocess.check_output([args.anvil, '--version'], text=True).strip()
    started = datetime.datetime.now(datetime.timezone.utc).isoformat()
    process = subprocess.Popen(
        [args.anvil, '--host', '127.0.0.1', '--port', str(args.port),
         '--chain-id', str(CHAIN_ID), '--hardfork', 'cancun', '--timestamp', '1700000000',
         '--gas-limit', str(TX_CAP), '--silent'],
        stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0, cwd=ROOT)
    url = f'http://127.0.0.1:{args.port}'
    sequence = 0
    scenario_time = 1700000000
    transaction_times = {}
    def rpc(method, params):
        nonlocal sequence
        sequence += 1
        request = Request(url, json.dumps({'jsonrpc':'2.0', 'id':sequence,
                          'method':method, 'params':params}).encode(),
                          {'Content-Type':'application/json'})
        with urlopen(request, timeout=5) as response:
            result = json.load(response)
        if 'error' in result:
            raise RuntimeError(f'{method}: {result["error"]}')
        return result['result']
    def artifact(name):
        return json.loads((ROOT/f'out/{name}.sol/{name}.json').read_text(encoding='utf-8'))
    def calldata(item, signature, payload=b''):
        return '0x'+item['methodIdentifiers'][signature]+payload.hex()
    def call(address, item, signature, payload=b''):
        return rpc('eth_call', [{'to':address, 'data':calldata(item,signature,payload)}, 'latest'])
    def number(address, item, signature, payload=b''):
        return int(call(address,item,signature,payload),16)
    def transact(data, to=None, value=0, gas=1_000_000):
        nonlocal scenario_time
        scenario_time += 1
        rpc('evm_setNextBlockTimestamp',[scenario_time])
        tx = {'from':sender, 'data':data, 'gas':hex(gas), 'value':hex(value),
              'gasPrice':rpc('eth_gasPrice',[])}
        if to is not None: tx['to'] = to
        tx_hash = rpc('eth_sendTransaction',[tx])
        deadline = time.monotonic()+20
        while True:
            receipt = rpc('eth_getTransactionReceipt',[tx_hash])
            if receipt is not None: break
            if time.monotonic()>deadline: raise RuntimeError('Receipt timeout')
            time.sleep(0.1)
        if int(receipt['status'],16)!=1: raise RuntimeError(f'Local transaction reverted: {tx_hash}')
        actual_time = int(rpc('eth_getBlockByNumber',[receipt['blockNumber'],False])['timestamp'],16)
        if actual_time != scenario_time: raise RuntimeError('Controlled scenario timestamp mismatch')
        transaction_times[tx_hash] = actual_time
        return receipt
    try:
        deadline = time.monotonic()+20
        while True:
            if process.poll() is not None: raise RuntimeError('Isolated Anvil exited before startup')
            try:
                chain = int(rpc('eth_chainId',[]),16)
                break
            except (OSError, RuntimeError):
                if time.monotonic()>=deadline: raise
                time.sleep(0.15)
        if chain!=CHAIN_ID: raise RuntimeError('Local chain ID mismatch; refusing deployment')
        items = {name:artifact(name) for name in
                 ('WorldDeploymentBSCV2','WorldTokenBSCV2','WorldCoreBSCV2','WorldLandProfileBSCV2')}
        dep, tok, cor, pro = (items[name] for name in items)
        sender = rpc('eth_accounts',[])[2]
        data = dep['bytecode']['object']
        receipt = transact(data, gas=8_000_000)
        factory = receipt['contractAddress']
        addresses = {label:'0x'+call(factory,dep,label+'()')[-40:] for label in ('token','core','profile')}
        token, core, profile = (addresses[label] for label in ('token','core','profile'))
        predictions = {label:'0x'+rpc('web3_sha3',['0xd694'+factory[2:]+f'{nonce:02x}'])[-40:]
                       for label,nonce in (('token',1),('core',2),('profile',3))}
        checks = {
            'tokenCoreEqualsCore':'0x'+call(token,tok,'core()')[-40:]==core,
            'coreTokenEqualsToken':'0x'+call(core,cor,'token()')[-40:]==token,
            'profileCoreEqualsCore':'0x'+call(profile,pro,'core()')[-40:]==core,
            'CREATEPredictionsMatchAllThree':addresses==predictions,
            'factoryNonceAfterThreeCreatesIs4':int(rpc('eth_getTransactionCount',[factory,'latest']),16)==4,
            'initialSupplyIsZero':number(token,tok,'totalSupply()')==0,
            'initialAccountedBNBIsZero':number(core,cor,'accountedBNB()')==0,
            'N50':number(core,cor,'N()')==50,
            'W65':number(core,cor,'W()')==65,
            'resistance45days':number(core,cor,'RESISTANCE_HALF_LIFE()')==3888000,
            'token18decimals':number(token,tok,'decimals()')==18,
            'T5184000':number(core,cor,'T()')==5184000,
            'priceUnchanged1e12':number(core,cor,'WORLD_PRICE()')==10**12,
            'declaredGasWithinLocalConfiguredCap':8_000_000<=TX_CAP,
            'actualGasBelowDeclaredLimit':int(receipt['gasUsed'],16)<8_000_000,
            'factoryInitcodeWithin49152':(len(data)-2)//2<=49152,
        }
        weights = []
        initial_lands = []
        for land in range(1,51):
            weights.append(number(core,cor,'weightOf(uint256)',word(land)))
            initial_lands.append(call(core,cor,'lands(uint256)',word(land)))
        checks['weightsSixFiveThreesFortyFourOnes'] = weights==[6]+[3]*5+[1]*44
        checks['weightSum65'] = sum(weights)==65
        checks['allFiftyInitialLandFieldsZero'] = all(int(raw,16)==0 for raw in initial_lands)
        initial_profile = decode_profile(call(profile,pro,'getCurrentProfile(uint256)',word(8)))
        checks['initialProfileUnset'] = initial_profile=={
            'valid':False,'controller':'0x'+'0'*40,'epoch':0,'fields':['','','']}
        runtimes = {}
        for name,address in [('WorldDeploymentBSCV2',factory),('WorldTokenBSCV2',token),
                             ('WorldCoreBSCV2',core),('WorldLandProfileBSCV2',profile)]:
            code = bytes.fromhex(rpc('eth_getCode',[address,'latest'])[2:])
            runtimes[name] = {'address':address,'bytes':len(code),'sha256':hashlib.sha256(code).hexdigest()}
            checks[name+'RuntimeWithin24576'] = 0<len(code)<=24576
            checks[name+'RuntimeLengthMatchesBuild'] = len(code)==(len(items[name]['deployedBytecode']['object'])-2)//2
        quantity = 100*10**18
        quoted = number(core,cor,'quoteBuy(uint256)',word(quantity))
        buy_receipt = transact(calldata(cor,'buyWorld(uint256,address)',word(quantity)+word(sender)),core,quoted)
        approve_receipt = transact(calldata(tok,'approve(address,uint256)',word(core)+word(quantity)),token)
        attack_receipt = transact(calldata(cor,'attack(uint256,uint256,uint256)',word(8)+word(0)+word(quantity)),core)
        land_words = bytes.fromhex(call(core,cor,'lands(uint256)',word(8))[2:])
        epoch = int.from_bytes(land_words[96:128],'big')
        checks['realBuyerAcquiredLand8'] = '0x'+land_words[12:32].hex()==sender and epoch==1
        def core_snapshot():
            state = {sig:call(core,cor,sig) for sig in
                     ('U0()','J0()','t0()','accountedBNB()')}
            state.update(land8=call(core,cor,'lands(uint256)',word(8)),
                         claimable=call(core,cor,'claimable(address)',word(sender)),
                         tokenSupply=call(token,tok,'totalSupply()'),
                         tokenCoreBalance=call(token,tok,'balanceOf(address)',word(core)),
                         nativeCoreBalance=rpc('eth_getBalance',[core,'latest']))
            return state
        before = core_snapshot()
        updates = []
        read_costs = []
        for label,fields in [
            ('firstSubmission',['天才明','https://example.com/logo.png','https://example.com']),
            ('sameEpochReplacement',['WORLD LAND 8','https://example.com/new.png','https://example.com/land/8']),
            ('maximumByteFields',['n'*64,'u'*256,'w'*256]),
            ('clearAllFields',['','',''])]:
            update = transact(calldata(pro,'setProfile(uint256,uint256,string,string,string)',
                                      encode_profile(8,epoch,fields)),profile)
            current = decode_profile(call(profile,pro,'getCurrentProfile(uint256)',word(8)))
            checks[label+'ReadbackCorrect'] = current=={'valid':True,'controller':sender,'epoch':epoch,'fields':fields}
            updates.append({'scenario':label,'utf8Bytes':list(map(lambda s:len(s.encode('utf-8')),fields)),
                            'gasUsed':int(update['gasUsed'],16),'receipt':update})
            query = {'from':sender,'to':profile,'data':calldata(pro,'getCurrentProfile(uint256)',word(8))}
            read_costs.append({'state':label,'estimateGasIncludingTransactionIntrinsic':int(rpc('eth_estimateGas',[query]),16),
                               'ethCallFeesPaid':0,'transactionSent':False})
        after = core_snapshot()
        checks['profileUpdatesPreserveCoreStoredAccounting'] = before==after
        checks['profileTokenAllowanceZero'] = number(token,tok,'allowance(address,address)',word(sender)+word(profile))==0
        checks['profileTokenBalanceZero'] = number(token,tok,'balanceOf(address)',word(profile))==0
        checks['profileNativeBalanceZero'] = int(rpc('eth_getBalance',[profile,'latest']),16)==0
        gas_scenarios = {'factory':receipt, 'buy':buy_receipt, 'initialTakeover':attack_receipt,
                         'profileFirstWrite':updates[0]['receipt']}
        def send_method(item, address, signature, args, value=0):
            return transact(calldata(item,signature,b''.join(word(x) for x in args)),address,value)
        def buy_more(q):
            return send_method(cor,core,'buyWorld(uint256,address)',[q,sender],number(core,cor,'quoteBuy(uint256)',word(q)))
        def land_epoch():
            raw=bytes.fromhex(call(core,cor,'lands(uint256)',word(8))[2:])
            return int.from_bytes(raw[96:128],'big')
        def war(label, signature, amount):
            supply_before=number(token,tok,'totalSupply()')
            balance_before=number(token,tok,'balanceOf(address)',word(sender))
            gas_scenarios[label]=send_method(cor,core,signature,[8,land_epoch(),amount])
            checks[label+'SupplyBurnExact']=number(token,tok,'totalSupply()')==supply_before-amount
            checks[label+'BalanceBurnExact']=number(token,tok,'balanceOf(address)',word(sender))==balance_before-amount
        buy_more(2000*10**18)
        send_method(tok,token,'approve(address,uint256)',[core,2**256-1])
        war('defend','defend(uint256,uint256,uint256)',20*10**18)
        war('nonCrossingAttack','attack(uint256,uint256,uint256)',10**18)
        sender=rpc('eth_accounts',[])[3]
        buy_more(2000*10**18)
        send_method(tok,token,'approve(address,uint256)',[core,2**256-1])
        war('takeover','attack(uint256,uint256,uint256)',number(core,cor,'minimumAttackAtoms(uint256)',word(8)))
        war('selfTakeover','attack(uint256,uint256,uint256)',10*10**18)
        anchor_raw=bytes.fromhex(call(core,cor,'lands(uint256)',word(8))[2:])
        anchor=int.from_bytes(anchor_raw[64:96],'big')
        scenario_time=anchor+2097151-1
        war('complexTimeDecayDefend','defend(uint256,uint256,uint256)',10**18)
        checks['warDoesNotCreateCoreInventory']=number(token,tok,'balanceOf(address)',word(core))==0
        evidence = {
            'status':'ACTUALLY EXECUTED' if all(checks.values()) else 'FAILED',
            'environment':'Isolated local Anvil, Cancun; NOT a BSC client or public BSC network',
            'startedAtUTC':started,'completedAtUTC':datetime.datetime.now(datetime.timezone.utc).isoformat(),
            'scenarioGenesisTimestamp':1700000000,'transactionBlockTimestamps':transaction_times,
            'anvilVersion':version,'chainId':chain,'rpc':url,'transactionHash':receipt['transactionHash'],
            'declaredGasLimit':8_000_000,'gasUsed':int(receipt['gasUsed'],16),
            'factoryInitcodeBytes':(len(data)-2)//2,'factoryInitcodeSHA256':hashlib.sha256(bytes.fromhex(data[2:])).hexdigest(),
            'gasScenarios':{label:{'gasUsed':int(r['gasUsed'],16),'receipt':r} for label,r in gas_scenarios.items()},
            'runtimes':runtimes,'checks':checks,'receipt':receipt,'CREATEPredictions':predictions,
            'initialWeights':weights,'initialProfile':initial_profile,
            'preparationReceipts':{'buy':buy_receipt,'approveCoreOnly':approve_receipt,'attackLand8':attack_receipt},
            'profileUpdates':updates,'profileReadResourceEstimates':read_costs,
            'profileAccountingBefore':before,'profileAccountingAfter':after,
            'publicTestnetDeployed':False,'publicMainnetDeployed':False,
            'limitations':['Gas units measured under local Cancun rules, not BSC live network rules or current prices.',
                          'eth_estimateGas is a transaction-equivalent resource estimate including intrinsic gas; eth_call does not charge gas.',
                          'Profile updates are measured in the listed order; maximum fields follow a previous short submission.',
                          'The private node is stopped when this script exits; its addresses are evidence, not a persistent DApp endpoint.']}
        target = ROOT/'evidence'
        target.mkdir(exist_ok=True)
        (target/'LOCAL_DEPLOYMENT_CHECK.json').write_text(json.dumps(evidence,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
        if not all(checks.values()):
            raise RuntimeError(f'Failed local checks: {[k for k,v in checks.items() if not v]}')
        config = {'environment':'LOCAL_MEASUREMENT_ONLY','chainId':chain,'rpc':url,
                  'deployment':factory,**addresses,'deploymentTransactionHash':receipt['transactionHash'],
                  'publicNetworkDeployment':False,'nodeStoppedAfterMeasurement':True,
                  'note':'Actual freshly deployed addresses read from the new factory; never use as BSC Testnet/Mainnet configuration.'}
        (target/'deployment.local.json').write_text(json.dumps(config,indent=2)+'\n',encoding='utf-8')
        print(json.dumps({'status':'PASS','checks':len(checks),'factoryGas':evidence['gasUsed'],
                          'profileGas':{row['scenario']:row['gasUsed'] for row in updates},
                          'readResourceEstimates':read_costs,'publicDeployment':False},ensure_ascii=False))
    finally:
        if process.poll() is None:
            process.terminate()
            try: process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)

if __name__=='__main__':
    main()
