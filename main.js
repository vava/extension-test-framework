var EXPORTED_SYMBOLS = ["run_tests"];

let makeImportRhino = function(dir) {
    return function(fileName) {
	    load(dir + fileName);
    };
};

let makeImportMozilla = function(id, dir) {
    return function(fileName) {
	var em = Components.classes["@mozilla.org/extensions/manager;1"].
		     getService(Components.interfaces.nsIExtensionManager);

	let path = dir + fileName;
	//make sure there's no '..' in path
	path = path.replace(/[^\/]+\/\.\.\//g, "");

	var file = em.getInstallLocation(id).getItemFile(id, path);

	var fstream = Components.classes["@mozilla.org/network/file-input-stream;1"].
			  createInstance(Components.interfaces.nsIFileInputStream);
	var sstream = Components.classes["@mozilla.org/scriptableinputstream;1"].
			  createInstance(Components.interfaces.nsIScriptableInputStream);
	fstream.init(file, -1, 0, 0);
	sstream.init(fstream);

	var data = "";
	var str = sstream.read(4096);
	while (str.length > 0) {
	    data += str;
	    str = sstream.read(4096);
	}

	sstream.close();
	fstream.close();

	eval(data);
    };
};

let getFileName = function(path) {
    var res = path.split(/[\\, \/]/);
    return res[res.length - 1];
};

let makeListFilesRhino = function(dir) {
    return function(fileName) {
	    importClass(java.io.File);
	    return (new File(dir + fileName)).list();
    };
};

let makeListFilesMozilla = function(id, dir) {
    return function(fileName) {
	var em = Components.classes["@mozilla.org/extensions/manager;1"].
		     getService(Components.interfaces.nsIExtensionManager);
	var file = em.getInstallLocation(id).getItemFile(id, dir + fileName);

	// file is the given directory (nsIFile)
	var entries = file.directoryEntries;
	var array = [];
	while(entries.hasMoreElements()) {
	    let entry = entries.getNext();
	    entry.QueryInterface(Components.interfaces.nsIFile);
	    array.push(getFileName(entry.path));
	}
	return array;
    };
};

let log = function() {
    var res;
    if (typeof(Components) != "undefined") {
	res = Components.utils.reportError;
    //be aware of the fact that Mozilla chrome also has function print() but it does print page to the printer
    } else if (typeof(print) != "undefined") {
	res = print;
    }
    return res;
}();

let isTestFile = function(path) {
    var filename = getFileName(path);
    return /^test.*\.js$/.test(filename);
};

let wrap = function(towrap, wrapwith) {
    return function () {
	var res;
	var args = arguments;
	var me = this;
	wrapwith(
	    function() { res = towrap.apply(me, args); }
	);
	return res;
    };
};

let checkGlobals = function(f) {
    return wrap(f, function(f) {
	var globalVars = {};
	for (let varName in this) {
	    globalVars[varName] = true;
	}

	f();

	var errors = [];
	for (let varName in this) {
	    if (typeof(globalVars[varName]) == "undefined") {
		if (varName != "ignoreGlobals" && (typeof(ignoreGlobals) == "undefined" || ignoreGlobals.indexOf(varName) == -1)) {
		    errors[varName] = "Warning: Reason: Polluted global namespace with '" + varName + "'";
		    assert.fail();
		}
	    }
	}
	for (let [v, text] in Iterator(errors)) {
	    delete this[v];
	    log(text);
	}
    })();
};

let prepLogs = function(p, f) {
    wrap(f, function(f) {
	var oldLog = log;
	log = function(t) { oldLog(p + t); };
	f();
	log = oldLog;
    })();
};

let ignore = function(name) {
    ignoreGlobals.push(name);
};

let init = function(test_dir, doc) {
    this.importFramework("framework_utils.js");

    this.window = this;
    if (typeof(doc) == "undefined") {
	importFramework("envjs/env.js");
	this.document = new DOMDocument(
		new java.io.ByteArrayInputStream(
		    (new java.lang.String("<html><body></body></html>").getBytes("UTF8"))));
    } else {
	let el = doc.createElementNS("http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul", "xul:browser");
	//doesn't work for some reason
	el.style.display = "none";
	let elb = doc.createElementNS("http://www.w3.org/1999/xhtml", "html:body");
	el.appendChild(elb);
	this.document = elb.ownerDocument;
    }
    if (typeof(Element) == "undefined") {
	window.Element = DOMElement;
	DOMElement.prototype.getElementsByClassName = function(className) {
	    var elements = [];
	    var all_elements = this.getElementsByTagName("*");
	    for (var i = 0; i < all_elements.length; i++) {
		if (all_elements[i] && all_elements[i].getAttribute("class") == className) {
		    elements.push(all_elements[i]);
		}
	    }
	    return elements;
	};
    }
};

let test = function(test_dir) {
    var files = listFiles(".").filter(isTestFile);

    for (let [, file] in Iterator(files)) {
	prepLogs(getFileName(file) + ": ", function() {
	    checkGlobals(function() {
		ignoreGlobals = ["location"];
		test = {};
		assert.mustNotThrow(function() {
		    importFile(file);
		    for (let varName in test) {
			ignoreGlobals.push(varName);
			prepLogs(varName + ": ", function() {
			    checkGlobals(function() {
				assert.mustNotThrow(function() {
				    test[varName]();
				});
				assert.clear();
			    });
			});
		    }
		});
		delete test;
	    });
	});
    }

    if (!assert.everything_ok()) {
	throw 1; //make exit code
    }
};

let init_mozilla = function(id, test_dir, doc) {
    this.importFile = makeImportMozilla(id, test_dir);
    this.importFramework = makeImportMozilla(id, "test-framework/");
    this.listFiles = makeListFilesMozilla(id, test_dir);
    init(test_dir, doc);
};

function run_tests(id, test_dir, doc) {
    init_mozilla(id, test_dir, doc);
    test(test_dir);
}

let init_rhino =function(test_dir) {
    this.importFile = makeImportRhino(test_dir);
    this.importFramework = makeImportRhino("test-framework/");
    this.listFiles = makeListFilesRhino(test_dir);
    init(test_dir);
};

if (typeof(importPackage) != "undefined") { //run under Rhino
    if (arguments.length != 2 || arguments[0] != "--test-directory") {
	print("Usage: java -cp test-framework/js.jar org.mozilla.javascript.tools.shell.Main -version 170 -debug test-framework/main.js --test-directory directory_with_tests");
	print("");
	print("Note: current directory ALWAYS should be one step up from test-framework");
    }

    let test_dir = arguments[1];

    init_rhino(test_dir);
    test(test_dir);
}
