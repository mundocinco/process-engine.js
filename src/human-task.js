var util = require('util');
var EventEmitter = require('events').EventEmitter;
var _ = require('lodash');
var Task = require('./process-definition.js').Task;
var ProcessEngine = require('./process-engine.js');
var ProcessInstance = require('./process-instance.js'),
    Instance = ProcessInstance.Instance,
    Node = ProcessInstance.Node;
var Promise = require("bluebird");
var debug = require('debug')('human-task');

/**
 * Human Task needs to be managed in a separate collection so that in any time
 * we can query/change task state without loading/saving process instances
 * until the task status is changed to complete
 */

function HumanTask() {
  HumanTask.super_.apply(this, arguments);
  this.type = 'human-task';
  this.assignee = null;
  this.candidateUsers = [];
  this.candidateGroups = [];
}
util.inherits(HumanTask, Task);

HumanTask.prototype.serialize = function () {
  var entity = HumanTask.super_.prototype.serialize.call(this);
  entity.assignee = this.assignee;
  entity.candidateUsers = this.candidateUsers;
  entity.candidateGroups = this.candidateGroups;
  return entity;
};

HumanTask.prototype.deserialize = function (entity) {
  HumanTask.super_.prototype.deserialize.call(this, entity);
  this.assignee = entity.assignee;
  this.candidateUsers = entity.candidateUsers;
  this.candidateGroups = entity.candidateGroups;
};

function HumanTaskNode() {
  HumanTaskNode.super_.apply(this, arguments);
}
util.inherits(HumanTaskNode, Node);

HumanTaskNode.prototype.executeInternal = function (complete) {
  var taskDef = {
    processId: this.processInstance.id,
    processName: this.processInstance.def.name,
    processVariables: this.processInstance.variables,
    definitionId: this.processInstance.def._id
  };
  _.extend(taskDef, this.task);
  this.processInstance.engine.humanTaskService.newTask(taskDef).then(function (entity) {
    this.taskEntityId = entity._id;
    // Put it in the waiting status
    return this.processInstance.changeStatus(Instance.STATUS.WAITING);
  }.bind(this)).done();
};

function HumanTaskService(engine) {
  this.engine = engine;
}

HumanTaskService.STATUS = {
  NEW: 'New',
  // only has single candidate || one of candidates claims the task
  RESERVED: 'Reserved',
  // the assignee starts to work on the task
  IN_PROGRESS: 'In Progress',
  COMPLETED: 'Completed'
};
HumanTaskService.prototype.complete = function (taskId, variables) {
  return this.queryOne({'_id': taskId}).bind(this).then(function (task) {
    if (!task) throw new Error('No task is found!');
    task.status = HumanTaskService.STATUS.COMPLETED;
    return task;
  }).then(function (task) {
    return this.saveTask(task).done(function () {
      if (task.processId !== undefined)
        this.engine.completeTask(task.processId, task.taskDefId, variables);
    }.bind(this));
  });
};

HumanTaskService.prototype.newTask = function (taskDef) {
  var task = {
    name: taskDef.name,
    status: taskDef.assignee ? HumanTaskService.STATUS.RESERVED: HumanTaskService.STATUS.NEW,
    assignee: taskDef.assignee,
    candidateUsers: taskDef.candidateUsers,
    candidateGroups: taskDef.candidateGroups,
    processId: taskDef.processId,
    processName: taskDef.processName,
    processVariables: taskDef.processVariables,
    definitionId: taskDef.definitionId,
    taskDefId: taskDef.id,
    createdTime: new Date(),
    modifiedTime: new Date()
  };
  
  return this.engine.humanTaskCollection.insertAsync(task);
};

HumanTaskService.prototype.saveTask = function (task) {
  task.modifiedTime = new Date();
  return this.engine.humanTaskCollection.updateAsync({'_id': task._id}, task, {});
};

HumanTaskService.prototype.claim = function (taskId, user) {
  return this.engine.humanTaskCollection.findOneAsync({'_id': taskId})
  .then(function (task) {
    if (task) {
      if (task.assignee === user) return;
      if (task.candidateUsers.indexOf(user) === -1) throw new Error('cannot claim task because user is not the candidate');
      task.assignee = user;
      task.status = HumanTaskService.STATUS.IN_PROGRESS;
      return this.saveTask(task);
    }
  }.bind(this));
};

HumanTaskService.prototype.startWorking = function (taskId) {
  return this.queryOne({'_id': taskId}).then(function (task) {
    if (!task) throw new Error('No task is found!');
    task.status = HumanTaskService.STATUS.IN_PROGRESS;
    return this.saveTask(task);
  }.bind(this));
};

HumanTaskService.prototype.query = function (conditions) {
  return this.engine.humanTaskCollection.findAsync(conditions);
};

HumanTaskService.prototype.queryOne = function (conditions) {
  return this.engine.humanTaskCollection.findOneAsync(conditions);
};


module.exports = {
  Service: HumanTaskService,
  Task: HumanTask,
  Node: HumanTaskNode
};

