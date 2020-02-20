module.exports = {
    classAndMethodComparator: function (a, b) {
        return  a["Method"]["$"]["classname"] == b["Method"]["$"]["classname"] &&
                a["Method"]["$"]["name"] == b["Method"]["$"]["name"] &&
                a["Method"]["$"]["signature"] == b["Method"]["$"]["signature"];
    }
}