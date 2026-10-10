import { Request, Response, NextFunction } from "express";
import { CameraService, cameraService } from "./camera.service";
import {
  CreateCameraDto,
  UpdateCameraDto,
  CameraQueryDto,
  CreateCameraStreamDto,
  UpdateCameraStreamDto,
  UpdateCameraConfigDto,
  CameraHealthLogQueryDto,
} from "./camera.dto";

export class CameraController {
  private readonly service: CameraService;

  constructor(service?: CameraService) {
    this.service = service || cameraService;
  }

  // ── Camera Endpoints ───────────────────────────────────────────────────────
  createCamera = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = req.body as CreateCameraDto;
      const result = await this.service.createCamera(body);
      res.status(201).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  };

  findCameraById = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const result = await this.service.findCameraById(id);
      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  };

  findAllCameras = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const query = req.query as unknown as CameraQueryDto;
      const result = await this.service.findAllCameras(query);
      res.json({
        success: true,
        data: result.data,
        meta: result.meta,
      });
    } catch (error) {
      next(error);
    }
  };

  updateCamera = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const body = req.body as UpdateCameraDto;
      const result = await this.service.updateCamera(id, body);
      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  };

  deleteCamera = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const result = await this.service.deleteCamera(id);
      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  };

  // ── Camera Config Endpoints ────────────────────────────────────────────────
  getCameraConfig = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const result = await this.service.getCameraConfig(id);
      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  };

  updateCameraConfig = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { id } = req.params;
      const body = req.body as UpdateCameraConfigDto;
      const result = await this.service.updateCameraConfig(id, body);
      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  };

  // ── Camera Stream Endpoints ────────────────────────────────────────────────
  getCameraStreams = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { id } = req.params;
      const result = await this.service.findStreamsByCameraId(id);
      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  };

  createCameraStream = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { id } = req.params;
      const body = req.body as Omit<CreateCameraStreamDto, "cameraId">;
      const result = await this.service.createCameraStream(id, body);
      res.status(201).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  };

  createCameraStreamDirect = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const body = req.body as CreateCameraStreamDto;
      const result = await this.service.createCameraStream(body.cameraId, body);
      res.status(201).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  };

  findCameraStreamById = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { id } = req.params;
      const result = await this.service.findCameraStreamById(id);
      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  };

  updateCameraStream = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { id } = req.params;
      const body = req.body as UpdateCameraStreamDto;
      const result = await this.service.updateCameraStream(id, body);
      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  };

  deleteCameraStream = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { id } = req.params;
      const result = await this.service.deleteCameraStream(id);
      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  };

  // ── Health Probe & Ping Endpoints ──────────────────────────────────────────
  pingCamera = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const result = await this.service.pingCamera(id);
      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  };

  getCameraHealthLogs = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { id } = req.params;
      const query = req.query as unknown as CameraHealthLogQueryDto;
      const result = await this.service.findHealthLogs({
        ...query,
        cameraId: id,
      });
      res.json({
        success: true,
        data: result.data,
        meta: result.meta,
      });
    } catch (error) {
      next(error);
    }
  };
}

export const cameraController = new CameraController();
